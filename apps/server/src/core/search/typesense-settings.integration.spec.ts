import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { TypesenseConfigService } from '../../integrations/search/typesense-config.service';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { TypesenseService } from './typesense.service';
import {
  up,
  down,
} from '../../database/migrations/20261113T130000-typesense-settings';

import { up as moveCredentials } from '../../database/migrations/20261113T140000-typesense-server-credentials';

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
    await sql`insert into workspace_search_configs (workspace_id, url, api_key, locale)
      values (${workspaceId}, 'http://obsolete:8108', 'obsolete-encrypted-key', 'en')`.execute(
      db,
    );
    await moveCredentials(db);
    const columns = await db.introspection.getTables();
    expect(
      columns
        .find((table) => table.name === 'workspace_search_configs')
        .columns.map((column) => column.name),
    ).toEqual(['workspace_id', 'locale']);
    const environment = new EnvironmentService(
      new ConfigService({
        TYPESENSE_URL: process.env.TYPESENSE_TEST_URL,
        TYPESENSE_API_KEY: process.env.TYPESENSE_TEST_API_KEY,
      }),
    );
    config = new TypesenseConfigService(db, environment, queue as any);
    service = new TypesenseService(config, db, queue as any);
  });

  afterAll(async () => {
    for (const locale of ['en', 'zh']) {
      await fetch(
        `${process.env.TYPESENSE_TEST_URL}/collections/docmost_pages_v2_${locale}`,
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

  it('keeps workspace languages while using only server credentials for indexing and search', async () => {
    expect(await config.isConfigured(workspaceId)).toBe(true);
    expect((await config.get(workspaceId)).locale).toBe('en');
    const saved = await config.save(workspaceId, {
      locale: 'en',
    });
    expect(saved).toEqual({
      configured: true,
      locale: 'en',
    });
    const stored = await db
      .selectFrom('workspaceSearchConfigs')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();
    expect(stored).toEqual({ workspaceId, locale: 'en' });
    expect(await config.isConfigured(otherWorkspaceId)).toBe(true);
    expect((await config.get(otherWorkspaceId)).locale).toBe('zh');
    await service.syncPages([pageId], true, workspaceId);
    expect(
      (await service.search('colaboration', workspaceId, false, 1)).hits.map(
        (hit) => hit.document.id,
      ),
    ).toEqual([pageId]);

    // A language change keeps using the same server credentials.
    await config.save(workspaceId, {
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
    // The FK prevents orphaned language preferences.
    await sql`delete from workspaces where id = ${workspaceId}`.execute(db);
    expect(
      await db.selectFrom('workspaceSearchConfigs').selectAll().execute(),
    ).toEqual([]);
  }, 30000);
});
