import { TypesenseClient } from './typesense.client';
import { QueueJob } from '../../integrations/queue/constants';

const livePage = {
  id: '019a1f00-0000-7000-8000-000000000010',
  title: '中文文档',
  textContent: 'Search content',
  workspaceId: '019a1f00-0000-7000-8000-000000000001',
  spaceId: '019a1f00-0000-7000-8000-000000000002',
  deletedAt: null,
};
const deletedId = '019a1f00-0000-7000-8000-000000000011';

function setup(rows: any[] = []) {
  const qb: any = {};
  for (const name of ['select', 'where', 'orderBy', 'limit', '$if']) {
    qb[name] = jest.fn().mockReturnValue(qb);
  }
  qb.execute = jest.fn().mockResolvedValue(rows);
  const db = { selectFrom: jest.fn().mockReturnValue(qb) };
  const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
  const environment = {
    isTypesenseConfigured: jest.fn().mockReturnValue(true),
    getTypesenseUrl: () => 'http://localhost:8108/CaseSensitive/',
    getTypesenseApiKey: () => 'server-secret',
    getTypesenseLocale: () => 'zh',
  };
  const service = new TypesenseClient(
    {
      url: environment.getTypesenseUrl(),
      apiKey: environment.getTypesenseApiKey(),
      locale: environment.getTypesenseLocale(),
    },
    db as any,
    queue as any,
    livePage.workspaceId,
  );
  return { service, qb, queue, environment };
}

describe('TypesenseService', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest.spyOn(global, 'fetch');
  });
  afterEach(() => jest.restoreAllMocks());

  it('creates a Chinese collection after 404 and preserves URL case', async () => {
    const { service } = setup();
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 404 }))
      .mockResolvedValueOnce(new Response('{}'));
    await service.ensureCollection();
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      'http://localhost:8108/CaseSensitive/collections/docmost_pages_v1_zh',
    );
    const create = JSON.parse(fetchMock.mock.calls[1][1].body);
    expect(create.fields).toEqual(
      expect.arrayContaining([
        { name: 'title', type: 'string', locale: 'zh' },
        { name: 'text', type: 'string', locale: 'zh' },
      ]),
    );
    await service.ensureCollection();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not treat authentication errors as missing collections and retries later', async () => {
    const { service } = setup();
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}'));
    await expect(service.ensureCollection()).rejects.toThrow('(401)');
    await service.ensureCollection();
    expect(fetchMock.mock.calls.every((call) => !call[1].method)).toBe(true);
  });

  it('upserts current page state and removes deleted or missing pages', async () => {
    const { service } = setup([
      livePage,
      { ...livePage, id: deletedId, deletedAt: new Date() },
    ]);
    fetchMock
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{"num_deleted":1}'))
      .mockResolvedValueOnce(new Response('{"success":true}\n'));
    await service.syncPages([livePage.id, deletedId]);
    const removeUrl = fetchMock.mock.calls[1][0] as URL;
    expect(removeUrl.searchParams.get('filter_by')).toBe(
      `workspaceId:=${livePage.workspaceId} && (id:=[${deletedId}])`,
    );
    const upsert = fetchMock.mock.calls[2];
    expect((upsert[0] as URL).searchParams.get('action')).toBe('upsert');
    expect(JSON.parse(upsert[1].body)).toEqual({
      id: livePage.id,
      title: livePage.title,
      text: livePage.textContent,
      workspaceId: livePage.workspaceId,
      spaceId: livePage.spaceId,
    });
    expect(upsert[1].headers['X-TYPESENSE-API-KEY']).toBe('server-secret');
  });

  it('retries partial import failures even when HTTP status is 200', async () => {
    const { service } = setup([livePage]);
    fetchMock
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(
        new Response('{"success":false,"error":"bad document"}\n'),
      );
    await expect(service.syncPages([livePage.id])).rejects.toThrow(
      'failed to import',
    );
  });

  it('retries creation events that arrive before the database commit', async () => {
    const { service } = setup([]);
    fetchMock.mockResolvedValueOnce(new Response('{}'));
    await expect(service.syncPages([livePage.id], true)).rejects.toThrow(
      'not visible yet',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('keeps query results limited to IDs in the server-selected workspace', async () => {
    const { service } = setup();
    fetchMock
      .mockResolvedValueOnce(new Response('{}'))
      .mockResolvedValueOnce(new Response('{"found":0,"hits":[]}'));
    await service.search(
      'hello && workspaceId:=other',
      livePage.workspaceId,
      true,
      1,
    );
    const url = fetchMock.mock.calls[1][0] as URL;
    expect(url.searchParams.get('q')).toBe('hello && workspaceId:=other');
    expect(url.searchParams.get('filter_by')).toBe(
      `workspaceId:=${livePage.workspaceId}`,
    );
    expect(url.searchParams.get('query_by')).toBe('title');
    expect(url.searchParams.get('include_fields')).toBe('id');
  });

  it('keeps workspace-scoped backfill jobs scoped across batches', async () => {
    const rows = Array.from({ length: 250 }, () => ({ id: livePage.id }));
    const { service, qb, queue } = setup(rows);
    qb.$if.mockImplementation((condition, callback) => {
      if (condition) callback(qb);
      return qb;
    });
    jest.spyOn(service, 'syncPages').mockResolvedValue();

    await service.reindexBatch(deletedId);

    expect(qb.where).toHaveBeenCalledWith(
      'workspaceId',
      '=',
      livePage.workspaceId,
    );
    expect(qb.where).toHaveBeenCalledWith('id', '>', deletedId);
    expect(queue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_PAGES,
      { cursor: livePage.id, workspaceId: livePage.workspaceId },
      expect.objectContaining({
        jobId: `typesense-reindex-${livePage.workspaceId}-${livePage.id}`,
      }),
    );
  });
});
