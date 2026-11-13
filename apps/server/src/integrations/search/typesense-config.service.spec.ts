import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../environment/environment.service';
import { TypesenseConfigService } from './typesense-config.service';
import { QueueJob } from '../queue/constants';

const connection = {
  TYPESENSE_URL: 'http://typesense:8108/',
  TYPESENSE_API_KEY: 'server-secret',
};

function setup(config: Record<string, string> = connection) {
  const rows = new Map<string, any>();
  const db = {
    selectFrom: jest.fn(() => {
      let workspaceId: string;
      const qb: any = {
        select: () => qb,
        where: (_field: string, _op: string, value: string) => {
          workspaceId = value;
          return qb;
        },
        executeTakeFirst: async () => rows.get(workspaceId),
      };
      return qb;
    }),
    insertInto: jest.fn(() => {
      let values: any;
      const qb: any = {
        values: (value: any) => {
          values = value;
          return qb;
        },
        onConflict: () => qb,
        execute: async () => rows.set(values.workspaceId, values),
      };
      return qb;
    }),
  };
  const environment = new EnvironmentService(new ConfigService(config));
  const queue = { add: jest.fn() };
  const service = new TypesenseConfigService(
    db as any,
    environment,
    queue as any,
  );
  return { service, rows, queue, db };
}

describe('Typesense server connection and workspace language', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(new Response('[]'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('uses the environment for every workspace before any settings are saved', async () => {
    const { service } = setup();
    for (const id of ['workspace-1', 'workspace-2']) {
      expect(await service.isConfigured(id)).toBe(true);
      expect(await service.get(id)).toEqual({
        url: 'http://typesense:8108',
        apiKey: connection.TYPESENSE_API_KEY,
        locale: 'zh',
      });
    }
    expect(await service.get('')).toBeUndefined();
  });

  it('stores only the language and does not return the address or key to the browser', async () => {
    const { service, rows, queue } = setup();
    expect(await service.save('workspace-1', { locale: 'en' })).toEqual({
      locale: 'en',
      configured: true,
    });
    expect(rows.get('workspace-1')).toEqual({
      workspaceId: 'workspace-1',
      locale: 'en',
    });
    expect(queue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_PAGES,
      { workspaceId: 'workspace-1' },
      expect.objectContaining({ attempts: 5 }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://typesense:8108/collections',
      expect.objectContaining({
        headers: { 'X-TYPESENSE-API-KEY': connection.TYPESENSE_API_KEY },
        redirect: 'error',
      }),
    );
    expect(await service.getSettings('workspace-2')).toEqual({
      locale: 'zh',
      configured: true,
    });
  });

  it('ignores addresses and keys from old database rows and client payloads', async () => {
    const { service, rows } = setup();
    rows.set('workspace-1', {
      url: 'http://old:8108',
      apiKey: 'old-key',
      locale: 'en',
    });
    expect(await service.get('workspace-1')).toEqual({
      url: 'http://typesense:8108',
      apiKey: connection.TYPESENSE_API_KEY,
      locale: 'en',
    });
    await service.testConnection('workspace-1', {
      locale: 'zh',
      url: 'http://untrusted:8108',
      apiKey: 'client-key',
    } as any);
    expect(fetchMock.mock.calls[0][0]).toBe(
      'http://typesense:8108/collections',
    );
    expect(fetchMock.mock.calls[0][1].headers['X-TYPESENSE-API-KEY']).toBe(
      connection.TYPESENSE_API_KEY,
    );
  });

  it('tests without changing workspace settings or queuing indexing', async () => {
    const { service, rows, queue } = setup();
    expect(
      await service.testConnection('workspace-1', { locale: 'en' }),
    ).toEqual({ success: true });
    expect(rows.size).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it.each([
    {},
    { TYPESENSE_URL: connection.TYPESENSE_URL },
    { TYPESENSE_API_KEY: 'key' },
  ])(
    'does not use stored credentials when the server connection is incomplete (%j)',
    async (env) => {
      const { service, rows, queue } = setup(env);
      rows.set('workspace-1', {
        url: 'http://old:8108',
        apiKey: 'old-key',
        locale: 'en',
      });
      expect(await service.isConfigured('workspace-1')).toBe(false);
      expect(await service.get('workspace-1')).toBeUndefined();
      expect(await service.getSettings('workspace-1')).toEqual({
        locale: 'en',
        configured: false,
      });
      await expect(
        service.save('workspace-1', { locale: 'zh' }),
      ).rejects.toThrow('Configure TYPESENSE_URL');
      expect(fetchMock).not.toHaveBeenCalled();
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it.each([401, 503])(
    'rejects failed connections (%s) without saving the language',
    async (status) => {
      const { service, rows, queue } = setup();
      rows.set('workspace-1', { workspaceId: 'workspace-1', locale: 'zh' });
      fetchMock.mockResolvedValueOnce(
        new Response('private response', { status }),
      );
      await expect(
        service.save('workspace-1', { locale: 'en' }),
      ).rejects.toThrow('Unable to connect to Typesense');
      expect(rows.get('workspace-1').locale).toBe('zh');
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('does not treat the public health response as a successful key check', async () => {
    const { service, rows } = setup();
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    await expect(service.save('workspace-1', { locale: 'zh' })).rejects.toThrow(
      'Unable to connect',
    );
    expect(rows.size).toBe(0);
  });
});
