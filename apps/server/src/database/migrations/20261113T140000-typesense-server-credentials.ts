import { type Kysely } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // Connection credentials now come exclusively from the server environment.
  // Keep each workspace's language preference while removing stored secrets.
  await db.schema
    .alterTable('workspace_search_configs')
    .dropColumn('url')
    .dropColumn('api_key')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  // Removed credentials cannot be restored; the old UI must configure them again.
  await db.schema
    .alterTable('workspace_search_configs')
    .addColumn('url', 'text', (col) => col.notNull().defaultTo(''))
    .addColumn('api_key', 'text', (col) => col.notNull().defaultTo(''))
    .execute();
}
