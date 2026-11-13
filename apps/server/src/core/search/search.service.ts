import { Injectable } from '@nestjs/common';
import { SearchDTO, SearchSuggestionDTO } from './dto/search.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql, SqlBool } from 'kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { highlightSubstrings } from './search-highlight';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

@Injectable()
export class SearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private pageRepo: PageRepo,
    private shareRepo: ShareRepo,
    private spaceMemberRepo: SpaceMemberRepo,
    private pagePermissionRepo: PagePermissionRepo,
  ) {}

  async searchPage(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
      publicPageIds?: string[];
      // Internal only: candidate IDs ranked by an external search engine.
      candidatePageIds?: string[];
    },
  ): Promise<{ items: SearchResponseDto[] }> {
    const query = searchParams.query?.trim() ?? '';
    const indexedSearch = opts.candidatePageIds !== undefined;
    if (indexedSearch && opts.candidatePageIds.length === 0) {
      return { items: [] };
    }
    const labelIds = [...new Set(searchParams.labelIds ?? [])];
    // selected filters (labels, creator) are browsable without a query
    const browseByFilters =
      query.length < 1 &&
      (labelIds.length > 0 || Boolean(searchParams.creatorId));

    if (query.length < 1 && !browseByFilters) {
      return { items: [] };
    }
    const titleOnly = searchParams.titleOnly === true;
    // PostgreSQL's default parser treats contiguous Chinese text (including
    // adjacent digits/Latin letters) as one lexeme. Match inside it literally.
    const substringSearch =
      !titleOnly && (indexedSearch || /\p{Script=Han}/u.test(query));
    const substringTerms = [...new Set(query.split(/\s+/u).filter(Boolean))];
    const substringPatterns = substringTerms.map(
      (term) => `%${term.replace(/[\\%_]/g, '\\$&')}%`,
    );
    const searchQuery = substringSearch ? '' : tsquery(query + '*');
    const titleQuery = query;
    // escape LIKE wildcards; ranking keeps the raw query
    const titleLikeQuery = query.replace(/[\\%_]/g, '\\$&');

    const rankColumn =
      browseByFilters || indexedSearch
        ? sql<number>`0`.as('rank')
        : titleOnly
          ? sql<number>`word_similarity(lower(${titleQuery}), lower(pages.title))`.as(
              'rank',
            )
          : substringSearch
            ? sql<number>`${sql.join(
                substringPatterns.map(
                  (pattern) =>
                    sql`CASE WHEN lower(pages.title) LIKE lower(${pattern}) THEN 1 ELSE 0 END`,
                ),
                sql` + `,
              )}`.as('rank')
            : sql<number>`ts_rank(tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as(
                'rank',
              );

    let queryResults = this.db
      .selectFrom('pages')
      .select([
        'id',
        'slugId',
        'title',
        'icon',
        'parentPageId',
        'creatorId',
        'createdAt',
        'updatedAt',
        rankColumn,
      ])
      .$if(
        !indexedSearch && !browseByFilters && !titleOnly && !substringSearch,
        (qb) =>
          qb.where(
            'tsv',
            '@@',
            sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
          ),
      )
      .$if(!indexedSearch && substringSearch, (qb) =>
        qb.where((eb) =>
          eb.and(
            substringPatterns.map((pattern) =>
              eb.or([
                eb(sql`lower(pages.title)`, 'like', sql`lower(${pattern})`),
                eb(
                  sql`lower(pages.text_content)`,
                  'like',
                  sql`lower(${pattern})`,
                ),
              ]),
            ),
          ),
        ),
      )
      .$if(!indexedSearch && !browseByFilters && titleOnly, (qb) =>
        qb.where((eb) =>
          eb(
            sql`lower(pages.title)`,
            'like',
            sql`lower(${`%${titleLikeQuery}%`})`,
          ),
        ),
      )
      .$if(Boolean(searchParams.creatorId), (qb) =>
        qb.where('creatorId', '=', searchParams.creatorId),
      )
      .$if(labelIds?.length > 0, (qb) =>
        qb.where(
          'id',
          'in',
          this.db
            .selectFrom('pageLabels')
            .select('pageId')
            .where('labelId', 'in', labelIds),
        ),
      )
      .where('deletedAt', 'is', null)
      .where('workspaceId', '=', opts.workspaceId)
      // Authorize every restricted ancestor before pagination. Filtering only
      // the limited result set can hide all accessible matches on later rows.
      .$if(Boolean(opts.userId), (qb) =>
        qb.where(sql<SqlBool>`NOT EXISTS (
        WITH RECURSIVE ancestors AS (
          SELECT p.id, p.parent_page_id FROM pages p WHERE p.id = pages.id
          UNION ALL
          SELECT p.id, p.parent_page_id FROM pages p
          JOIN ancestors a ON a.parent_page_id = p.id
        )
        SELECT 1 FROM ancestors a
        JOIN page_access pa ON pa.page_id = a.id
        WHERE NOT EXISTS (
          SELECT 1 FROM page_permissions pp
          WHERE pp.page_access_id = pa.id
            AND (pp.user_id = ${opts.userId}::uuid OR pp.group_id IN (
              SELECT gu.group_id FROM group_users gu
              WHERE gu.user_id = ${opts.userId}::uuid
            ))
        )
      )`),
      )
      .$if(indexedSearch, (qb) => qb.where('id', 'in', opts.candidatePageIds))
      .$if(browseByFilters, (qb) => qb.orderBy('updatedAt', 'desc'))
      .$if(!browseByFilters, (qb) => qb.orderBy('rank', 'desc'))
      .orderBy('id', 'asc')
      .limit(searchParams.limit || 25)
      .offset(searchParams.offset || 0);

    if (!searchParams.shareId && !opts.publicPageIds) {
      queryResults = queryResults.select((eb) =>
        this.pageRepo.withSpace(eb, { includeArchivedAt: true }),
      );
    }

    if (searchParams.spaceId && opts.userId) {
      queryResults = queryResults.where('spaceId', '=', searchParams.spaceId);
    } else if (opts.userId && !searchParams.spaceId) {
      // only search spaces the user is a member of
      queryResults = queryResults
        .where(
          'spaceId',
          'in',
          this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId, {
            excludeArchived: !searchParams.includeArchived,
          }),
        )
        .where('workspaceId', '=', opts.workspaceId);
    } else if (opts.publicPageIds && !opts.userId) {
      // Public space search: the allowed id set is computed from live DB
      // state by the controller on every request.
      if (opts.publicPageIds.length === 0) {
        return { items: [] };
      }
      queryResults = queryResults
        .where('id', 'in', opts.publicPageIds)
        .where('workspaceId', '=', opts.workspaceId);
    } else if (searchParams.shareId && !searchParams.spaceId && !opts.userId) {
      // search in shares
      const shareId = searchParams.shareId;
      const share = await this.shareRepo.findById(shareId);
      if (!share || share.workspaceId !== opts.workspaceId) {
        return { items: [] };
      }

      const isRestricted = await this.pagePermissionRepo.hasRestrictedAncestor(
        share.pageId,
      );
      if (isRestricted) {
        return { items: [] };
      }

      const pageIdsToSearch = [];
      if (share.includeSubPages) {
        const pageList =
          await this.pageRepo.getPageAndDescendantsExcludingRestricted(
            share.pageId,
            {
              includeContent: false,
            },
          );

        pageIdsToSearch.push(...pageList.map((page) => page.id));
      } else {
        pageIdsToSearch.push(share.pageId);
      }

      if (pageIdsToSearch.length > 0) {
        queryResults = queryResults
          .where('id', 'in', pageIdsToSearch)
          .where('workspaceId', '=', opts.workspaceId);
      } else {
        return { items: [] };
      }
    } else {
      return { items: [] };
    }

    //@ts-ignore
    let results: any[] = await queryResults.execute();

    if (indexedSearch) {
      const positions = new Map(
        opts.candidatePageIds.map((id, index) => [id, index]),
      );
      results.sort((a, b) => positions.get(a.id) - positions.get(b.id));
    }

    // Filter results by page-level permissions (if user is authenticated)
    if (opts.userId && results.length > 0) {
      const pageIds = results.map((r: any) => r.id);
      const accessibleIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds,
          userId: opts.userId,
          spaceId: searchParams.spaceId,
        });
      const accessibleSet = new Set(accessibleIds);
      results = results.filter((r: any) => accessibleSet.has(r.id));
    }

    if (!browseByFilters && !titleOnly && results.length > 0) {
      // Retrieve a bounded excerpt around the first literal body match, even
      // when it appears beyond the full-text headline's 100,000 character cap.
      const firstMatch = sql`least(${sql.join(
        substringTerms.map(
          (term) => sql`nullif(strpos(lower(text_content), lower(${term})), 0)`,
        ),
      )})`;
      const highlightColumn = substringSearch
        ? sql<string>`substring(text_content from greatest(1, ${firstMatch} - 60) for 320)`
        : sql<string>`ts_headline('english', substring(text_content, 1, 100000), to_tsquery('english', f_unaccent(${searchQuery})),'MinWords=9, MaxWords=10, MaxFragments=3')`;
      const highlights = await this.db
        .selectFrom('pages')
        .select(['id', highlightColumn.as('highlight')])
        .where(
          'id',
          'in',
          results.map((r: any) => r.id),
        )
        .execute();
      const highlightById = new Map(highlights.map((h) => [h.id, h.highlight]));
      for (const result of results) {
        result.highlight = highlightById.get(result.id) ?? '';
      }
    }

    //@ts-ignore
    const searchResults = results.map((result: SearchResponseDto) => {
      result.wholeWord = !substringSearch;
      if (substringSearch) {
        Object.assign(
          result,
          highlightSubstrings(result.highlight ?? '', substringTerms),
        );
        return result;
      }
      if (!result.highlight) {
        result.highlight = '';
        result.matchedText = [];
        return result;
      }

      result.highlight = result.highlight
        .replace(/\r\n|\r|\n/g, ' ')
        .replace(/\s+/g, ' ');

      result.matchedText = [
        ...new Set(
          Array.from(
            result.highlight.matchAll(/<b>([^<]*)<\/b>/gi),
            (match) => match[1],
          ),
        ),
      ];

      return result;
    });

    return { items: searchResults };
  }

  async searchSuggestions(
    suggestion: SearchSuggestionDTO,
    userId: string,
    workspaceId: string,
  ) {
    let users = [];
    let groups = [];
    let pages = [];

    const limit = suggestion?.limit || 10;
    const query = suggestion.query.toLowerCase().trim();

    if (suggestion.includeUsers) {
      const userQuery = this.db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'avatarUrl'])
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .where((eb) =>
          eb.or([
            eb(
              sql`LOWER(f_unaccent(users.name))`,
              'like',
              sql`LOWER(f_unaccent(${`%${query}%`}))`,
            ),
            eb(sql`users.email`, 'ilike', sql`f_unaccent(${`%${query}%`})`),
          ]),
        )
        .limit(limit);

      users = await userQuery.execute();
    }

    if (suggestion.includeGroups) {
      groups = await this.db
        .selectFrom('groups')
        .select(['id', 'name', 'description'])
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(groups.name))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('workspaceId', '=', workspaceId)
        .limit(limit)
        .execute();
    }

    if (suggestion.includePages) {
      let pageSearch = this.db
        .selectFrom('pages')
        .select(['id', 'slugId', 'title', 'icon', 'spaceId'])
        .select((eb) => this.pageRepo.withSpace(eb))
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(pages.title))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('deletedAt', 'is', null)
        .where('workspaceId', '=', workspaceId)
        .limit(limit);

      // search all spaces the user has access to, prioritizing the current space
      // archived spaces are left out, except the current one
      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId, {
        excludeArchived: true,
        keepArchivedSpaceId: suggestion.spaceId,
      });

      if (userSpaceIds?.length > 0) {
        pageSearch = pageSearch.where('spaceId', 'in', userSpaceIds);

        if (suggestion?.spaceId) {
          pageSearch = pageSearch.orderBy(
            sql`CASE WHEN pages."space_id" = ${suggestion.spaceId} THEN 0 ELSE 1 END`,
            'asc',
          );
        }

        pages = await pageSearch.execute();
      }

      // Filter by page-level permissions
      if (pages.length > 0) {
        const pageIds = pages.map((p) => p.id);
        const accessibleIds =
          await this.pagePermissionRepo.filterAccessiblePageIds({
            pageIds,
            userId,
          });
        const accessibleSet = new Set(accessibleIds);
        pages = pages.filter((p) => accessibleSet.has(p.id));
      }
    }

    return { users, groups, pages };
  }
}
