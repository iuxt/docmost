import {
  CamelCasePlugin,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
  sql,
} from 'kysely';
import { SearchService } from './search.service';

// Keep repository injection tokens without loading their application modules.
jest.mock('@docmost/db/repos/page/page.repo', () => ({ PageRepo: class {} }));
jest.mock('@docmost/db/repos/share/share.repo', () => ({
  ShareRepo: class {},
}));
jest.mock('@docmost/db/repos/space/space-member.repo', () => ({
  SpaceMemberRepo: class {},
}));
jest.mock('@docmost/db/repos/page/page-permission.repo', () => ({
  PagePermissionRepo: class {},
}));

function buildService(rows: Record<string, unknown>[] = [], excerpt = '') {
  const executeQuery = jest
    .fn()
    .mockResolvedValueOnce({ rows })
    .mockResolvedValueOnce({ rows: [{ id: 'page-1', highlight: excerpt }] });
  const driver = new DummyDriver();
  jest.spyOn(driver, 'acquireConnection').mockResolvedValue({
    executeQuery,
    async *streamQuery() {},
  });
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new CamelCasePlugin()],
  });
  const pagePermissionRepo = {
    filterAccessiblePageIds: jest.fn().mockResolvedValue(['page-1']),
  };
  const service = new SearchService(
    db as any,
    { withSpace: () => sql`null`.as('space') } as any,
    {} as any,
    { getUserSpaceIdsQuery: () => db.selectFrom('spaces').select('id') } as any,
    pagePermissionRepo as any,
  );
  return { service, executeQuery, pagePermissionRepo };
}

const opts = { userId: 'user-1', workspaceId: 'workspace-1' };

describe('SearchService page matching', () => {
  it('matches Chinese substrings and enables navigation inside words', async () => {
    const { service, executeQuery } = buildService(
      [{ id: 'page-1', title: 'Test' }],
      '123中文测试123',
    );
    const { items } = await service.searchPage({ query: '中文' } as any, opts);

    expect(executeQuery.mock.calls[0][0].sql).toContain(
      'lower(pages.text_content) like',
    );
    expect(executeQuery.mock.calls[0][0].sql).not.toContain('to_tsquery');
    expect(executeQuery.mock.calls[0][0].parameters).toContain('%中文%');
    expect(executeQuery.mock.calls[1][0].sql).toContain('strpos');
    expect(items[0]).toMatchObject({
      highlight: '123<b>中文</b>测试123',
      matchedText: ['中文'],
      wholeWord: false,
    });
  });

  it('escapes LIKE wildcards in mixed Chinese queries', async () => {
    const { service, executeQuery } = buildService();
    await service.searchPage({ query: '中文%_\\ english' } as any, opts);

    const query = executeQuery.mock.calls[0][0];
    expect(query.parameters).toContain('%中文\\%\\_\\\\%');
    expect(query.parameters).toContain('%english%');
    expect(query.sql).toContain(') and (');
  });

  it('keeps English stemming, prefix matching and headlines', async () => {
    const { service, executeQuery } = buildService(
      [{ id: 'page-1', title: 'Test' }],
      '哈哈哈-<b>english</b>-xxx',
    );
    const { items } = await service.searchPage(
      { query: 'english' } as any,
      opts,
    );

    expect(executeQuery.mock.calls[0][0].sql).toContain('to_tsquery');
    expect(executeQuery.mock.calls[1][0].sql).toContain('ts_headline');
    expect(items[0]).toMatchObject({
      matchedText: ['english'],
      wholeWord: true,
    });
  });

  it('leaves title-only searches scoped to the title', async () => {
    const { service, executeQuery } = buildService();
    await service.searchPage({ query: '中文', titleOnly: true } as any, opts);

    expect(executeQuery.mock.calls[0][0].sql).toContain(
      'lower(pages.title) like',
    );
    expect(executeQuery.mock.calls[0][0].sql).not.toContain('text_content');
  });

  it('filters restricted matches before fetching their body excerpts', async () => {
    const { service, executeQuery, pagePermissionRepo } = buildService([
      { id: 'page-1', title: 'Restricted' },
    ]);
    pagePermissionRepo.filterAccessiblePageIds.mockResolvedValue([]);

    expect(await service.searchPage({ query: '中文' } as any, opts)).toEqual({
      items: [],
    });
    expect(pagePermissionRepo.filterAccessiblePageIds).toHaveBeenCalled();
    expect(executeQuery).toHaveBeenCalledTimes(1);
    expect(executeQuery.mock.calls[0][0].sql).toContain('"workspace_id" =');
    expect(executeQuery.mock.calls[0][0].sql).toContain('"deleted_at" is null');
  });
});
