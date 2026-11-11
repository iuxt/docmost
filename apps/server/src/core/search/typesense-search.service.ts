import { Injectable, Logger } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { SearchDTO } from './dto/search.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { SearchService } from './search.service';
import { TypesenseService } from './typesense.service';

@Injectable()
export class TypesenseSearchService {
  private readonly logger = new Logger(TypesenseSearchService.name);

  constructor(
    private readonly typesense: TypesenseService,
    private readonly searchService: SearchService,
  ) {}

  async searchPage(
    params: SearchDTO,
    opts: { userId?: string; workspaceId: string; publicPageIds?: string[] },
  ): Promise<{ items: SearchResponseDto[] }> {
    const query = params.query?.trim();
    // Browsing by creator/labels requires no full-text engine.
    if (!query) return this.searchService.searchPage(params, opts);
    if (opts.publicPageIds?.length === 0) return { items: [] };

    try {
      const offset = Math.max(0, Math.trunc(params.offset || 0));
      const limit = Math.min(100, Math.max(1, Math.trunc(params.limit || 25)));
      const items: SearchResponseDto[] = [];
      const seen = new Set<string>();
      // Paginate after live authorization so restricted/stale hits do not leave
      // holes or make the user-provided offset skip accessible pages.
      for (let page = 1; items.length < offset + limit; page++) {
        const result = await this.typesense.search(
          query,
          opts.workspaceId,
          params.titleOnly === true,
          page,
        );
        const hits = result.hits ?? [];
        if (hits.length === 0) break;
        const candidatePageIds = hits
          .map((hit) => hit.document.id)
          .filter((id) => {
            if (!isUUID(id) || seen.has(id)) return false;
            seen.add(id);
            return true;
          });
        if (candidatePageIds.length) {
          const authorized = await this.searchService.searchPage(
            { ...params, limit: candidatePageIds.length, offset: 0 },
            { ...opts, candidatePageIds },
          );
          items.push(...authorized.items);
        }
        if (page * 100 >= result.found) break;
      }
      return { items: items.slice(offset, offset + limit) };
    } catch {
      this.logger.warn(
        'Typesense search unavailable; falling back to database search',
      );
      return this.searchService.searchPage(params, opts);
    }
  }
}
