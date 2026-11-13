import { TypesenseService } from './typesense.service';
import { QueueJob } from '../../integrations/queue/constants';

const workspaceId = '019a1f00-0000-7000-8000-000000000001';

describe('Typesense database configuration at runtime', () => {
  it('uses newly saved addresses, keys and locales on the next search', async () => {
    const config = { url: 'http://old:8108', apiKey: 'old-key', locale: 'zh' };
    const provider = { get: jest.fn(async () => ({ ...config })) };
    const service = new TypesenseService(provider as any, {} as any, {} as any);
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async (url) =>
          new Response(String(url).includes('/search') ? '{"found":0}' : '{}'),
      );
    try {
      await service.search('hello', workspaceId, false, 1);
      Object.assign(config, {
        url: 'http://new:8108',
        apiKey: 'new-key',
        locale: 'en',
      });
      await service.search('hello', workspaceId, false, 1);
      expect(String(fetchMock.mock.calls[3][0])).toContain(
        'http://new:8108/collections/docmost_pages_v2_en/documents/search',
      );
      expect(
        (fetchMock.mock.calls[3][1].headers as any)['X-TYPESENSE-API-KEY'],
      ).toBe('new-key');
      expect(provider.get).toHaveBeenCalledWith(workspaceId);
    } finally {
      fetchMock.mockRestore();
    }
  });

  it('schedules reconciliation before the first connection is configured', async () => {
    const queue = { add: jest.fn(), upsertJobScheduler: jest.fn() };
    const service = new TypesenseService({} as any, {} as any, queue as any);
    await service.onApplicationBootstrap();
    expect(queue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_PAGES,
      {},
      expect.any(Object),
    );
    expect(queue.upsertJobScheduler).toHaveBeenCalledWith(
      'typesense-reconcile',
      { every: 3600000 },
      expect.any(Object),
    );
  });

  it('fans out reconciliation only to configured workspaces', async () => {
    const config = {
      isConfigured: jest.fn(async (id) => id === workspaceId),
      queueBackfill: jest.fn(),
    };
    const db = {
      selectFrom: () => ({
        select: () => ({
          execute: async () => [{ id: workspaceId }, { id: 'unconfigured' }],
        }),
      }),
    };
    const service = new TypesenseService(config as any, db as any, {} as any);
    await service.reindexBatch();
    expect(config.queueBackfill).toHaveBeenCalledTimes(1);
    expect(config.queueBackfill).toHaveBeenCalledWith(workspaceId);
  });

  it('skips queued updates after a connection is removed', async () => {
    const service = new TypesenseService(
      { get: async () => undefined } as any,
      {} as any,
      {} as any,
    );
    await expect(
      service.syncPages(['page-id'], false, workspaceId),
    ).resolves.toBeUndefined();
  });
});
