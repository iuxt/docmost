import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  // The title already has a trigram index. Index body substring searches too.
  await sql`CREATE INDEX IF NOT EXISTS pages_text_content_trgm_idx
    ON pages USING gin (lower(text_content) gin_trgm_ops)
    WHERE deleted_at IS NULL`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS pages_text_content_trgm_idx`.execute(db);
}
