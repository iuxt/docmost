import { Queue } from 'bullmq';
import { isUUID } from 'class-validator';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import type { TypesenseConfig } from '../../integrations/search/typesense-config.service';
import { QueueJob } from '../../integrations/queue/constants';

class TypesenseError extends Error {
  constructor(readonly status: number) {
    // Do not include response bodies, URLs or API keys in logs.
    super(`Typesense request failed (${status})`);
  }
}

export interface TypesenseHits {
  found: number;
  hits?: { document: { id: string } }[];
}

const INDEX_BATCH_SIZE = 250;

// Use the same Han character boundaries at index and query time, regardless of
// the selected locale or ICU dictionary. This also separates adjacent numbers
// and Latin words from Chinese text without changing their own tokenization.
function segmentChinese(value: string) {
  return value.replace(/\p{Script=Han}/gu, ' $& ');
}

export class TypesenseClient {
  private collectionReady?: Promise<void>;

  constructor(
    private readonly config: TypesenseConfig,
    private readonly db: KyselyDB,
    private readonly queue: Queue,
    private readonly workspaceId: string,
  ) {
    if (!isUUID(workspaceId)) throw new Error('Invalid workspace ID');
  }

  get collectionName() {
    // Tokenization changes require a fresh index, including existing pages.
    return `docmost_pages_v2_${this.config.locale}`;
  }

  async request<T>(
    path: string,
    init: RequestInit = {},
    params: Record<string, string> = {},
  ): Promise<T> {
    const url = new URL(`${this.config.url.replace(/\/$/, '')}/${path}`);
    for (const [key, value] of Object.entries(params)) {
      url.searchParams.set(key, value);
    }
    const response = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-TYPESENSE-API-KEY': this.config.apiKey,
        ...init.headers,
      },
      signal: AbortSignal.timeout(10000),
      redirect: 'error',
    });
    if (!response.ok) throw new TypesenseError(response.status);
    // Import returns JSONL, not a JSON array. Every row must be checked.
    if (path.endsWith('/import')) {
      return (await response.text()) as T;
    }
    return (await response.json()) as T;
  }

  async ensureCollection() {
    if (!this.collectionReady) {
      this.collectionReady = this.createCollection().catch((error) => {
        this.collectionReady = undefined;
        throw error;
      });
    }
    return this.collectionReady;
  }

  private async createCollection() {
    try {
      await this.request(`collections/${this.collectionName}`);
      return;
    } catch (error) {
      if (!(error instanceof TypesenseError) || error.status !== 404)
        throw error;
    }
    try {
      await this.request('collections', {
        method: 'POST',
        body: JSON.stringify({
          name: this.collectionName,
          fields: [
            {
              name: 'title',
              type: 'string',
              locale: this.config.locale,
            },
            {
              name: 'text',
              type: 'string',
              locale: this.config.locale,
            },
            { name: 'workspaceId', type: 'string', facet: true },
            { name: 'spaceId', type: 'string', facet: true },
          ],
        }),
      });
    } catch (error) {
      // Another server may have created the collection at the same time.
      if (!(error instanceof TypesenseError) || error.status !== 409)
        throw error;
    }
  }

  async search(
    query: string,
    workspaceId: string,
    titleOnly: boolean,
    page: number,
  ) {
    if (workspaceId !== this.workspaceId)
      throw new Error('Invalid workspace ID');
    await this.ensureCollection();
    // Workspace IDs are server-provided UUIDs; never interpolate client filters.
    if (!isUUID(workspaceId)) throw new Error('Invalid workspace ID');
    return this.request<TypesenseHits>(
      `collections/${this.collectionName}/documents/search`,
      {},
      {
        q: segmentChinese(query),
        pre_segmented_query: String(/\p{Script=Han}/u.test(query)),
        // Do not silently discard a character or correct an identifier when
        // the full query has no matches.
        drop_tokens_threshold: '0',
        enable_typos_for_numerical_tokens: 'false',
        query_by: titleOnly ? 'title' : 'title,text',
        query_by_weights: titleOnly ? '4' : '4,1',
        filter_by: `workspaceId:=${workspaceId}`,
        include_fields: 'id',
        highlight_fields: 'none',
        per_page: '100',
        page: String(page),
      },
    );
  }

  async syncPages(pageIds: string[], requireExisting = false) {
    if (pageIds.length === 0) return;
    await this.ensureCollection();
    for (let offset = 0; offset < pageIds.length; offset += INDEX_BATCH_SIZE) {
      const batch = pageIds.slice(offset, offset + INDEX_BATCH_SIZE);
      const ids = batch.filter((id) => isUUID(id));
      const slugs = batch.filter((id) => !isUUID(id));
      const pages = await this.db
        .selectFrom('pages')
        .select([
          'id',
          'title',
          'textContent',
          'workspaceId',
          'spaceId',
          'deletedAt',
        ])
        .where('workspaceId', '=', this.workspaceId)
        .where((eb) =>
          eb.or([
            ...(ids.length ? [eb('id', 'in', ids)] : []),
            ...(slugs.length ? [eb('slugId', 'in', slugs)] : []),
          ]),
        )
        .execute();
      // Creation events can arrive before their transaction commits. Retry
      // rather than marking an invisible new page as successfully indexed.
      if (requireExisting && pages.length < new Set(batch).size) {
        throw new Error('Created pages are not visible yet');
      }
      const livePages = pages.filter((page) => !page.deletedAt);
      const liveIds = new Set(livePages.map((page) => page.id));
      const removedIds = [
        ...new Set([
          ...ids.filter((id) => !liveIds.has(id)),
          ...pages.filter((page) => page.deletedAt).map((page) => page.id),
        ]),
      ];
      if (removedIds.length) {
        await this.removeByFilter(`id:=[${removedIds.join(',')}]`);
      }
      if (!livePages.length) continue;
      const result = await this.request<string>(
        `collections/${this.collectionName}/documents/import`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain' },
          body: livePages
            .map((page) =>
              JSON.stringify({
                id: page.id,
                title: segmentChinese(page.title ?? ''),
                text: segmentChinese(page.textContent ?? ''),
                workspaceId: page.workspaceId,
                spaceId: page.spaceId,
              }),
            )
            .join('\n'),
        },
        { action: 'upsert' },
      );
      const rows = result
        .trim()
        .split('\n')
        .filter(Boolean)
        .map((row) => JSON.parse(row));
      if (
        rows.length !== livePages.length ||
        rows.some((row) => row.success !== true)
      ) {
        throw new Error('Typesense failed to import one or more pages');
      }
    }
  }

  async removeByFilter(filter: string) {
    await this.ensureCollection();
    await this.request(
      `collections/${this.collectionName}/documents`,
      { method: 'DELETE' },
      { filter_by: `workspaceId:=${this.workspaceId} && (${filter})` },
    );
  }

  async reindexBatch(cursor?: string) {
    const workspaceId = this.workspaceId;
    const pages = await this.db
      .selectFrom('pages')
      .select('id')
      .$if(Boolean(workspaceId), (qb) =>
        qb.where('workspaceId', '=', workspaceId),
      )
      .$if(Boolean(cursor), (qb) => qb.where('id', '>', cursor))
      .orderBy('id')
      .limit(INDEX_BATCH_SIZE)
      .execute();
    await this.syncPages(pages.map((page) => page.id));
    if (pages.length === INDEX_BATCH_SIZE) {
      const nextCursor = pages[pages.length - 1].id;
      await this.queue.add(
        QueueJob.SEARCH_INDEX_PAGES,
        { cursor: nextCursor, ...(workspaceId ? { workspaceId } : {}) },
        {
          jobId: `typesense-reindex-${workspaceId ?? 'all'}-${nextCursor}`,
          attempts: 5,
          backoff: { type: 'exponential', delay: 20000 },
          removeOnComplete: true,
          removeOnFail: true,
        },
      );
    }
  }
}
