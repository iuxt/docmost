import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { EncryptionService } from '../../integrations/encryption/encryption.service';
import { TypesenseConfigService } from '../../integrations/search/typesense-config.service';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { TypesenseService } from './typesense.service';
import {
  up,
  down,
} from '../../database/migrations/20261113T130000-typesense-settings';

// Requires disposable PostgreSQL AND Typesense instances. This suite creates and drops tables.
const describeIntegration =
  process.env.TYPESENSE_TEST_DATABASE_URL && process.env.TYPESENSE_TEST_URL
    ? describe
    : describe.skip;

describeIntegration('Typesense settings database integration', () => {
  const workspaceId = '019a1f00-0000-7000-8000-000000000001';
  const otherWorkspaceId = '019a1f00-0000-7000-8000-000000000099';
  const pageId = '019a1f00-0000-7000-8000-000000000010';
  let db: KyselyDB;
  let config: TypesenseConfigService;
  let service: TypesenseService;
  const queue = { add: jest.fn() };

  beforeAll(async () => {
    db = new Kysely({
      dialect: new PostgresJSDialect({
        postgres: postgres(process.env.TYPESENSE_TEST_DATABASE_URL),
      }),
      plugins: [new CamelCasePlugin()],
    }) as KyselyDB;
    await sql`create table workspaces (id uuid primary key)`.execute(db);
    await up(db);
    await sql`create table pages (id uuid primary key, slug_id text, title text, text_content text, workspace_id uuid, space_id uuid, deleted_at timestamptz)`.execute(
      db,
    );
    await sql`insert into workspaces (id) values (${workspaceId}), (${otherWorkspaceId})`.execute(
      db,
    );
    await sql`insert into pages (id, title, text_content, workspace_id, space_id) values (${pageId}, '中文测试文档', 'Collaboration handbook', ${workspaceId}, ${workspaceId})`.execute(
      db,
    );
    // Deliberately omit all application Typesense environment variables.
    const environment = new EnvironmentService(
      new ConfigService({ APP_SECRET: 'disposable-test-app-secret'.repeat(2) }),
    );
    config = new TypesenseConfigService(
      db,
      new EncryptionService(environment),
      environment,
      queue as any,
    );
    service = new TypesenseService(config, db, queue as any);
  });

  afterAll(async () => {
    for (const locale of ['en', 'zh']) {
      await fetch(
        `${process.env.TYPESENSE_TEST_URL}/collections/docmost_pages_v1_${locale}`,
        {
          method: 'DELETE',
          headers: {
            'X-TYPESENSE-API-KEY': process.env.TYPESENSE_TEST_API_KEY,
          },
        },
      );
    }
    if (db) {
      await down(db);
      await sql`drop table pages`.execute(db);
      await sql`drop table workspaces`.execute(db);
      await db.destroy();
    }
  });

  it('saves encrypted credentials and changes indexing/search immediately without application environment variables', async () => {
    expect(await config.isConfigured(workspaceId)).toBe(false);
    const saved = await config.save(workspaceId, {
      url: process.env.TYPESENSE_TEST_URL,
      apiKey: process.env.TYPESENSE_TEST_API_KEY,
      locale: 'en',
    });
    expect(saved).toEqual({
      url: process.env.TYPESENSE_TEST_URL,
      hasApiKey: true,
      locale: 'en',
    });
    const stored = await db
      .selectFrom('workspaceSearchConfigs')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();
    expect(stored.apiKey).not.toBe(process.env.TYPESENSE_TEST_API_KEY);
    expect(await config.isConfigured(otherWorkspaceId)).toBe(false);
    await service.syncPages([pageId], true, workspaceId);
    expect(
      (await service.search('colaboration', workspaceId, false, 1)).hits.map(
        (hit) => hit.document.id,
      ),
    ).toEqual([pageId]);

    // Saving a language change without a key retains the encrypted credential.
    await config.save(workspaceId, {
      url: process.env.TYPESENSE_TEST_URL,
      locale: 'zh',
    });
    await service.reindexBatch(undefined, workspaceId);
    expect(
      (await service.search('中文', workspaceId, true, 1)).hits.map(
        (hit) => hit.document.id,
      ),
    ).toEqual([pageId]);
    // Updates without workspaceId, emitted by PageRepo, still reach the current connection.
    await sql`update pages set title = '更新后的苹果文档' where id = ${pageId}`.execute(
      db,
    );
    await service.syncPages([pageId]);
    expect((await service.search('苹果', workspaceId, true, 1)).found).toBe(1);

    await sql`delete from pages where id = ${pageId}`.execute(db);
    await service.syncPages([pageId], false, workspaceId);
    expect((await service.search('苹果', workspaceId, true, 1)).found).toBe(0);
    // The FK prevents orphaned stored credentials.
    await sql`delete from workspaces where id = ${workspaceId}`.execute(db);
    expect(
      await db.selectFrom('workspaceSearchConfigs').selectAll().execute(),
    ).toEqual([]);
  }, 30000);
});
