import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../environment/environment.service';
import {
  EncryptionPurpose,
  EncryptionService,
} from '../encryption/encryption.service';
import { TypesenseConfigService } from './typesense-config.service';
import { QueueJob } from '../queue/constants';

function setup(legacy: Record<string, string> = {}) {
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
  const environment = new EnvironmentService(
    new ConfigService({ APP_SECRET: 'test-secret-'.repeat(4), ...legacy }),
  );
  const encryption = new EncryptionService(environment);
  const queue = { add: jest.fn() };
  const service = new TypesenseConfigService(
    db as any,
    encryption,
    environment,
    queue as any,
  );
  return { service, rows, encryption, queue, db };
}

const dto = {
  url: 'http://typesense:8108/',
  apiKey: 'workspace-secret',
  locale: 'zh',
};

describe('Typesense connection settings', () => {
  let fetchMock: jest.SpyInstance;
  beforeEach(() => {
    fetchMock = jest
      .spyOn(global, 'fetch')
      .mockImplementation(async () => new Response('[]'));
  });
  afterEach(() => jest.restoreAllMocks());

  it('encrypts keys, returns only safe settings, and queues workspace indexing', async () => {
    const { service, rows, encryption, queue } = setup();
    const result = await service.save('workspace-1', dto);
    expect(result).toEqual({
      url: 'http://typesense:8108',
      locale: 'zh',
      hasApiKey: true,
    });
    expect(JSON.stringify(result)).not.toContain(dto.apiKey);
    const stored = rows.get('workspace-1');
    expect(stored.apiKey).not.toContain(dto.apiKey);
    expect(
      encryption.decrypt(stored.apiKey, EncryptionPurpose.SEARCH_CREDENTIALS),
    ).toBe(dto.apiKey);
    expect(queue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_PAGES,
      { workspaceId: 'workspace-1' },
      expect.objectContaining({ attempts: 5 }),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'http://typesense:8108/collections',
      expect.objectContaining({
        headers: { 'X-TYPESENSE-API-KEY': dto.apiKey },
        redirect: 'error',
      }),
    );
  });

  it('retains the saved key when updating URL or language without a new key', async () => {
    const { service } = setup();
    await service.save('workspace-1', dto);
    await service.save('workspace-1', {
      url: 'http://new-search:8108',
      locale: 'en',
    });
    expect(await service.get('workspace-1')).toEqual({
      url: 'http://new-search:8108',
      locale: 'en',
      apiKey: dto.apiKey,
    });
    expect(fetchMock.mock.calls[1][1].headers['X-TYPESENSE-API-KEY']).toBe(
      dto.apiKey,
    );
  });

  it('tests unsaved values without changing the database or scheduling indexing', async () => {
    const { service, rows, queue } = setup();
    expect(await service.testConnection('workspace-1', dto)).toEqual({
      success: true,
    });
    expect(rows.size).toBe(0);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('isolates workspace credentials and cannot reuse another workspace key', async () => {
    const { service } = setup();
    await service.save('workspace-1', dto);
    expect(await service.isConfigured('workspace-2')).toBe(false);
    await expect(
      service.save('workspace-2', { url: dto.url, locale: 'zh' }),
    ).rejects.toThrow('API key is required');
    expect(await service.getSettings('workspace-2')).toEqual({
      url: '',
      locale: 'zh',
      hasApiKey: false,
    });
  });

  it.each([401, 503])(
    'rejects failed connections (%s) without overwriting the saved connection',
    async (status) => {
      const { service, queue } = setup();
      await service.save('workspace-1', dto);
      fetchMock.mockResolvedValueOnce(
        new Response('secret error response', { status }),
      );
      await expect(
        service.save('workspace-1', { ...dto, apiKey: 'bad-key' }),
      ).rejects.toThrow('Unable to connect to Typesense');
      expect((await service.get('workspace-1'))?.apiKey).toBe(dto.apiKey);
      expect(queue.add).toHaveBeenCalledTimes(1);
    },
  );

  it('does not accept a public health endpoint or arbitrary JSON as a connection test', async () => {
    const { service, rows } = setup();
    fetchMock.mockResolvedValueOnce(new Response('{"ok":true}'));
    await expect(service.save('workspace-1', dto)).rejects.toThrow(
      'Unable to connect',
    );
    expect(rows.size).toBe(0);
  });

  it('prefers saved settings over legacy environment values', async () => {
    const { service } = setup({
      TYPESENSE_URL: 'http://legacy:8108',
      TYPESENSE_API_KEY: 'legacy-key',
      TYPESENSE_LOCALE: 'en',
    });
    expect((await service.get('workspace-1'))?.apiKey).toBe('legacy-key');
    await service.save('workspace-1', dto);
    expect((await service.get('workspace-1'))?.apiKey).toBe(dto.apiKey);
    expect((await service.get('workspace-2'))?.apiKey).toBe('legacy-key');
  });
});
