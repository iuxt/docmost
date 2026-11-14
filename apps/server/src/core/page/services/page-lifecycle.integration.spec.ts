import { CamelCasePlugin, Kysely, sql } from 'kysely';
import { PostgresJSDialect } from 'kysely-postgres-js';
import * as postgres from 'postgres';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { TrashCleanupService } from './trash-cleanup.service';
import { SearchService } from '../../search/search.service';
import { PageService } from './page.service';

// Use a disposable database. Tables live in a dedicated schema removed afterward.
const run = process.env.REVIEW_TEST_DATABASE_URL ? describe : describe.skip;
const id = (n: number) =>
  `019a4f3e-0000-7000-8000-${String(n).padStart(12, '0')}`;
const workspaceId = id(1),
  spaceId = id(2),
  userId = id(3),
  rootId = id(10),
  childId = id(11);
const expired = new Date(Date.now() - 40 * 86400000);

run('Page lifecycle and authorized search (PostgreSQL)', () => {
  let db: Kysely<any>;
  let repo: PageRepo;
  let cleanup: TrashCleanupService;
  const queue = { add: jest.fn(async (..._args: any[]) => undefined) };
  const events = { emit: jest.fn() };

  beforeAll(async () => {
    const connection = postgres(process.env.REVIEW_TEST_DATABASE_URL, {
      connection: { search_path: 'docmost_review_fixes,public' },
      max: 6,
    });
    db = new Kysely({
      dialect: new PostgresJSDialect({ postgres: connection }),
      plugins: [new CamelCasePlugin()],
    });
    await sql`create schema docmost_review_fixes`.execute(db);
    await sql`create extension if not exists pg_trgm`.execute(db);
    await sql`create table workspaces (id uuid primary key, trash_retention_days int, deleted_at timestamptz)`.execute(
      db,
    );
    await sql`create table spaces (id uuid primary key, home_page_id uuid)`.execute(
      db,
    );
    await sql`create table shares (page_id uuid)`.execute(db);
    await sql`create table pages (
      id uuid primary key, slug_id text, title text, icon text,
      parent_page_id uuid references pages(id) on delete cascade,
      space_id uuid, workspace_id uuid, creator_id uuid,
      created_at timestamptz default now(), updated_at timestamptz default now(),
      deleted_at timestamptz, deleted_by_id uuid
      , position text, cover_photo text, cover_position double precision,
      cover_attribution jsonb, last_updated_by_id uuid, is_locked boolean,
      is_base boolean, contributor_ids uuid[]
    )`.execute(db);
    await sql`create table page_access (id uuid primary key, page_id uuid, space_id uuid)`.execute(
      db,
    );
    await sql`create table page_permissions (id uuid primary key, page_access_id uuid, user_id uuid, group_id uuid)`.execute(
      db,
    );
    await sql`create table group_users (user_id uuid, group_id uuid)`.execute(
      db,
    );
    repo = new PageRepo(
      db as any,
      {} as any,
      events as any,
      { copyInheritedRestriction: jest.fn() } as any,
    );
    cleanup = new TrashCleanupService(db as any, queue as any, repo);
  });

  beforeEach(async () => {
    jest.restoreAllMocks();
    queue.add.mockReset();
    events.emit.mockClear();
    queue.add.mockResolvedValue(undefined);
    for (const table of [
      'pagePermissions',
      'pageAccess',
      'groupUsers',
      'shares',
      'pages',
      'spaces',
      'workspaces',
    ]) {
      await db.deleteFrom(table).execute();
    }
    await db
      .insertInto('workspaces')
      .values({ id: workspaceId, trashRetentionDays: 30 })
      .execute();
    await db.insertInto('spaces').values({ id: spaceId }).execute();
  });

  afterAll(async () => {
    if (db) {
      await sql`drop schema docmost_review_fixes cascade`.execute(db);
      await db.destroy();
    }
  });

  async function tree(childDeletedAt: Date | null = expired) {
    await db
      .insertInto('pages')
      .values({ id: rootId, spaceId, workspaceId, deletedAt: expired })
      .execute();
    await db
      .insertInto('pages')
      .values({
        id: childId,
        parentPageId: rootId,
        spaceId,
        workspaceId,
        deletedAt: childDeletedAt,
      })
      .execute();
  }

  it.each(['create-first', 'delete-first'])(
    'serializes child creation and trashing (%s)',
    async (order) => {
      await db
        .insertInto('pages')
        .values({ id: rootId, workspaceId, spaceId })
        .execute();
      let acquired!: () => void, resume!: () => void, waiting!: () => void;
      const locked = new Promise<void>((resolve) => {
        acquired = resolve;
      });
      const release = new Promise<void>((resolve) => {
        resume = resolve;
      });
      const attempted = new Promise<void>((resolve) => {
        waiting = resolve;
      });
      const lock = repo.lockPageHierarchySpaces.bind(repo);
      let count = 0;
      jest
        .spyOn(repo, 'lockPageHierarchySpaces')
        .mockImplementation(async (...args) => {
          const first = ++count === 1;
          if (!first) waiting();
          await lock(...args);
          if (first) {
            acquired();
            await release;
          }
        });
      const create = () =>
        repo.insertPage({
          id: childId,
          slugId: 'child',
          position: 'a0',
          parentPageId: rootId,
          workspaceId,
          spaceId,
        } as any);
      const remove = () => repo.removePage(rootId, userId, workspaceId);
      const first = order === 'create-first' ? create() : remove();
      await locked;
      const second =
        order === 'create-first'
          ? remove()
          : expect(create()).rejects.toThrow('Parent page not found');
      try {
        await attempted;
      } finally {
        resume();
      }
      const results = await Promise.allSettled([first, second]);
      for (const result of results) expect(result.status).toBe('fulfilled');
      const pages = await db
        .selectFrom('pages')
        .select(['id', 'deletedAt'])
        .execute();
      expect(pages).toHaveLength(order === 'create-first' ? 2 : 1);
      expect(pages.every((page) => page.deletedAt !== null)).toBe(true);
    },
  );

  it('keeps attachment cleanup unqueued when a permanent page delete rolls back', async () => {
    await tree();
    const service = Object.create(PageService.prototype);
    service.pageRepo = repo;
    service.attachmentQueue = queue;
    service.eventEmitter = events;
    await sql`create function docmost_review_fixes.reject_delete() returns trigger language plpgsql as $$begin raise exception 'delete failed'; end$$`.execute(
      db,
    );
    await sql`create trigger reject_delete before delete on pages for each row execute function docmost_review_fixes.reject_delete()`.execute(
      db,
    );
    try {
      await expect(service.forceDelete(rootId, workspaceId)).rejects.toThrow(
        'delete failed',
      );
      expect(await db.selectFrom('pages').select('id').execute()).toHaveLength(
        2,
      );
      expect(queue.add).not.toHaveBeenCalled();
      expect(events.emit).not.toHaveBeenCalled();
    } finally {
      await sql`drop trigger reject_delete on pages`.execute(db);
      await sql`drop function docmost_review_fixes.reject_delete()`.execute(db);
    }
  });

  it('only queues permanent deletion attachments once page deletion is visible to other connections', async () => {
    await tree();
    const service = Object.create(PageService.prototype);
    service.pageRepo = repo;
    service.attachmentQueue = queue;
    service.eventEmitter = events;
    queue.add.mockImplementation(async () => {
      expect(await db.selectFrom('pages').select('id').execute()).toEqual([]);
    });
    await service.forceDelete(rootId, workspaceId);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it('preserves a tree restored after scanning but before the cleanup lock', async () => {
    await tree();
    let scanned!: () => void, proceed!: () => void;
    const atLock = new Promise<void>((resolve) => {
      scanned = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const lock = repo.lockPageHierarchySpaces.bind(repo);
    jest
      .spyOn(repo, 'lockPageHierarchySpaces')
      .mockImplementationOnce(async (...args) => {
        scanned();
        await resume;
        await lock(...args);
      });
    const cleaning = cleanup.cleanupOldTrash();
    await atLock;
    try {
      await repo.restorePage(rootId, workspaceId);
    } finally {
      proceed();
    }
    await cleaning;
    const pages = await db.selectFrom('pages').selectAll().execute();
    expect(pages).toHaveLength(2);
    expect(pages.every((page) => page.deletedAt === null)).toBe(true);
    expect(queue.add).not.toHaveBeenCalled();
  });

  it('serializes a restore behind deletion and queues files only after commit', async () => {
    await tree();
    let locked!: () => void, proceed!: () => void;
    const atLock = new Promise<void>((resolve) => {
      locked = resolve;
    });
    const resume = new Promise<void>((resolve) => {
      proceed = resolve;
    });
    const lock = repo.lockPageHierarchySpaces.bind(repo);
    jest
      .spyOn(repo, 'lockPageHierarchySpaces')
      .mockImplementationOnce(async (...args) => {
        await lock(...args);
        locked();
        await resume;
      });
    queue.add.mockImplementation(async () => {
      expect(await db.selectFrom('pages').select('id').execute()).toEqual([]);
    });
    const cleaning = cleanup.cleanupOldTrash();
    await atLock;
    const restoring = repo.restorePage(rootId, workspaceId);
    proceed();
    await Promise.all([cleaning, restoring]);
    expect(await db.selectFrom('pages').select('id').execute()).toEqual([]);
    expect(queue.add).toHaveBeenCalledTimes(2);
  });

  it.each([null, new Date()])(
    'does not cascade into a live or recently trashed child (%s)',
    async (childDeletedAt) => {
      await tree(childDeletedAt);
      await cleanup.cleanupOldTrash();
      expect(await db.selectFrom('pages').select('id').execute()).toHaveLength(
        2,
      );
      expect(queue.add).not.toHaveBeenCalled();
    },
  );

  it('keeps files when deletion rolls back', async () => {
    await tree();
    await sql`create function docmost_review_fixes.reject_delete() returns trigger language plpgsql as $$begin raise exception 'test failure'; end$$`.execute(
      db,
    );
    await sql`create trigger reject_delete before delete on pages for each row execute function docmost_review_fixes.reject_delete()`.execute(
      db,
    );
    try {
      await cleanup.cleanupOldTrash();
      expect(await db.selectFrom('pages').select('id').execute()).toHaveLength(
        2,
      );
      expect(queue.add).not.toHaveBeenCalled();
    } finally {
      await sql`drop trigger reject_delete on pages`.execute(db);
      await sql`drop function docmost_review_fixes.reject_delete()`.execute(db);
    }
  });

  function search() {
    const permissions = new PagePermissionRepo(db as any, {} as any, {} as any);
    return new SearchService(
      db as any,
      { withSpace: () => sql`null`.as('space') } as any,
      {} as any,
      {
        getUserSpaceIdsQuery: () => db.selectFrom('spaces').select('id'),
      } as any,
      permissions,
    );
  }

  it('paginates visible matches after restricted higher ranked matches', async () => {
    await db
      .insertInto('pages')
      .values(
        [10, 11, 12, 13, 14].map((n) => ({
          id: id(n),
          slugId: String(n),
          title: 'match',
          workspaceId,
          spaceId,
        })),
      )
      .execute();
    await db
      .insertInto('pageAccess')
      .values(
        [10, 11, 12].map((n) => ({ id: id(n + 100), pageId: id(n), spaceId })),
      )
      .execute();
    const first = await search().searchPage(
      { query: 'match', titleOnly: true, limit: 1, spaceId } as any,
      { userId, workspaceId },
    );
    expect(first.items.map((page) => page.id)).toEqual([id(13)]);
    const second = await search().searchPage(
      { query: 'match', titleOnly: true, limit: 1, offset: 1, spaceId } as any,
      { userId, workspaceId },
    );
    expect(second.items.map((page) => page.id)).toEqual([id(14)]);
  });

  it('requires grants on every restricted ancestor and honors group membership', async () => {
    await db
      .insertInto('pages')
      .values({ id: rootId, title: 'match', workspaceId, spaceId })
      .execute();
    await db
      .insertInto('pages')
      .values({
        id: childId,
        parentPageId: rootId,
        title: 'match',
        workspaceId,
        spaceId,
      })
      .execute();
    await db
      .insertInto('pageAccess')
      .values([
        { id: id(110), pageId: rootId, spaceId },
        { id: id(111), pageId: childId, spaceId },
      ])
      .execute();
    await db
      .insertInto('pagePermissions')
      .values({ id: id(210), pageAccessId: id(111), userId })
      .execute();
    const params = { query: 'match', titleOnly: true, spaceId } as any;
    expect(
      (await search().searchPage(params, { userId, workspaceId })).items,
    ).toEqual([]);
    await db
      .insertInto('groupUsers')
      .values({ userId, groupId: id(300) })
      .execute();
    await db
      .insertInto('pagePermissions')
      .values({ id: id(211), pageAccessId: id(110), groupId: id(300) })
      .execute();
    expect(
      (await search().searchPage(params, { userId, workspaceId })).items.map(
        (page) => page.id,
      ),
    ).toEqual([rootId, childId]);
  });
});
