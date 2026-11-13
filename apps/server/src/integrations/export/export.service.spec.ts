import {
  CamelCasePlugin,
  CompiledQuery,
  DummyDriver,
  Kysely,
  PostgresAdapter,
  PostgresIntrospector,
  PostgresQueryCompiler,
} from 'kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ExportFormat } from './dto/export-dto';
import { ExportService } from './export.service';

jest.mock('@sindresorhus/slugify', () => ({
  __esModule: true,
  default: (text: string) => text.toLowerCase().replace(/\s+/g, '-'),
}));

const WORKSPACE_ID = '019a4f3e-0000-7000-8000-000000000001';
const USER_ID = '019a4f3e-0000-7000-8000-000000000002';
const SPACE_ID = '019a4f3e-0000-7000-8000-000000000003';
const SOURCE_PAGE_ID = '019a4f3e-0000-7000-8000-000000000004';
const MENTIONED_PAGE_ID = '019a4f3e-0000-7000-8000-000000000005';
const BASE_URL = 'https://docs.example.com';

function pageMention(entityId: string, label: string) {
  return {
    type: 'mention',
    attrs: {
      id: `mention-${label}`,
      label,
      entityType: 'page',
      entityId,
      slugId: 'storedslug',
    },
  };
}

function docWith(...mentions: object[]) {
  return { type: 'doc', content: [{ type: 'paragraph', content: mentions }] };
}

// answers every pages select with the mentioned page, everything else with no rows
function buildService(opts: { accessiblePageIds: string[] }) {
  const queries: CompiledQuery[] = [];
  const driver = new DummyDriver();
  driver.acquireConnection = async () =>
    ({
      executeQuery: async (query: CompiledQuery) => ({
        rows: query.sql.includes('from "pages"')
          ? [
              {
                id: MENTIONED_PAGE_ID,
                slug_id: 'liveslug',
                title: 'Live title',
                creator_id: USER_ID,
                space_id: SPACE_ID,
                workspace_id: WORKSPACE_ID,
                space: { id: SPACE_ID, name: 'Private', slug: 'private' },
              },
            ]
          : [],
      }),
      streamQuery: async function* () {},
    }) as any;
  const db = new Kysely<any>({
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => driver,
      createIntrospector: (kysely) => new PostgresIntrospector(kysely),
      createQueryCompiler: () => new PostgresQueryCompiler(),
    },
    plugins: [new CamelCasePlugin()],
    log: (event) => {
      if (event.level === 'query') queries.push(event.query);
    },
  });

  const sourcePage = {
    id: SOURCE_PAGE_ID,
    slugId: 'sourceslug',
    title: 'Source',
    spaceId: SPACE_ID,
    workspaceId: WORKSPACE_ID,
    parentPageId: null,
    content: docWith(pageMention(MENTIONED_PAGE_ID, 'Stored label')),
  };
  const pageRepo = {
    findById: jest.fn().mockResolvedValue(sourcePage),
    withSpace: (eb: any) => PageRepo.prototype.withSpace(eb),
  };
  const pagePermissionRepo = {
    filterAccessiblePageIds: jest.fn(
      async ({ pageIds }: { pageIds: string[] }) =>
        pageIds.filter(
          (id) => id === SOURCE_PAGE_ID || opts.accessiblePageIds.includes(id),
        ),
    ),
  };
  const spaceMemberRepo = new SpaceMemberRepo(
    db as any,
    {} as any,
    {} as any,
    {} as any,
  );
  const domainService = { getUrl: () => BASE_URL };
  const service = new ExportService(
    pageRepo as any,
    pagePermissionRepo as any,
    db as any,
    {} as any,
    {} as any,
    domainService as any,
    spaceMemberRepo,
  );
  return { service, queries, pagePermissionRepo };
}

async function exportSinglePage(service: ExportService) {
  const result = await service.exportPages(
    SOURCE_PAGE_ID,
    ExportFormat.HTML,
    false,
    false,
    USER_ID,
  );
  if (result.type !== 'file') throw new Error('expected a single file');
  return result.content;
}

function mentionLookup(queries: CompiledQuery[]) {
  return queries.find((query) => query.sql.includes('from "pages"'));
}

describe('ExportService page mentions', () => {
  it('links a mentioned page the user can open with its current title', async () => {
    const { service } = buildService({
      accessiblePageIds: [MENTIONED_PAGE_ID],
    });

    const html = await exportSinglePage(service);

    expect(html).toContain(
      `href="${BASE_URL}/s/private/p/live-title-liveslug"`,
    );
    expect(html).toContain('Live title');
  });

  it('keeps the stored label in a single-page export when the user cannot open the mentioned page', async () => {
    const { service } = buildService({ accessiblePageIds: [] });

    const html = await exportSinglePage(service);

    expect(html).toContain('Stored label');
    expect(html).not.toContain('Live title');
    expect(html).not.toContain('/s/private/');
  });

  it("limits the mention lookup to live pages in the user's spaces", async () => {
    const { service, queries } = buildService({
      accessiblePageIds: [MENTIONED_PAGE_ID],
    });

    await service.turnPageMentionsToLinks(
      docWith(pageMention(MENTIONED_PAGE_ID, 'Stored label')),
      WORKSPACE_ID,
      BASE_URL,
      USER_ID,
    );

    const lookup = mentionLookup(queries);
    expect(lookup.sql).toContain('"deleted_at" is null');
    expect(lookup.sql).toContain('from "space_members"');
    expect(lookup.parameters).toContain(USER_ID);
  });

  it('skips page mentions without a valid page id', async () => {
    const { service, queries, pagePermissionRepo } = buildService({
      accessiblePageIds: [MENTIONED_PAGE_ID],
    });

    const json = await service.turnPageMentionsToLinks(
      docWith(
        pageMention('not-a-page-id', 'Broken'),
        pageMention(MENTIONED_PAGE_ID, 'Stored label'),
      ),
      WORKSPACE_ID,
      BASE_URL,
      USER_ID,
    );

    expect(mentionLookup(queries).parameters).not.toContain('not-a-page-id');
    for (const [args] of pagePermissionRepo.filterAccessiblePageIds.mock
      .calls) {
      expect(args.pageIds).not.toContain('not-a-page-id');
    }
    expect(JSON.stringify(json)).toContain('Live title');
  });
});

describe('ExportService filename collisions', () => {
  it('keeps every page, unique metadata paths and links when sanitized names collide', async () => {
    const titles = ['A?', 'A*', 'A (1)', 'a'];
    const pages: any[] = [
      {
        id: SOURCE_PAGE_ID,
        slugId: 'root',
        title: 'Root',
        parentPageId: null,
        workspaceId: WORKSPACE_ID,
        spaceId: SPACE_ID,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: titles.map((title, index) => ({
                type: 'text',
                text: title,
                marks: [
                  {
                    type: 'link',
                    attrs: {
                      href: `${BASE_URL}/s/private/p/title-child${index}`,
                    },
                  },
                ],
              })),
            },
          ],
        },
      },
      ...titles.map((title, index) => ({
        id: `child-${index}`,
        slugId: `child${index}`,
        title,
        parentPageId: SOURCE_PAGE_ID,
        workspaceId: WORKSPACE_ID,
        spaceId: SPACE_ID,
        content: {
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [{ type: 'text', text: `unique body ${index}` }],
            },
          ],
        },
      })),
    ];
    const { service } = buildService({ accessiblePageIds: [] });
    (service as any).pageRepo.getPageAndDescendants = async () => pages;
    const result = await service.exportPages(
      SOURCE_PAGE_ID,
      ExportFormat.Markdown,
      false,
      true,
      USER_ID,
      true,
    );
    if (result.type !== 'zip') throw new Error('expected ZIP');
    const zipBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      result.stream.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      result.stream.on('end', () => resolve(Buffer.concat(chunks)));
      result.stream.on('error', reject);
    });
    const JSZip = require('jszip');
    const zip = await JSZip.loadAsync(zipBuffer);
    const names = Object.keys(zip.files).filter((name) => name.endsWith('.md'));
    expect(names).toHaveLength(5);
    expect(new Set(names.map((name) => name.toLowerCase())).size).toBe(5);
    const metadata = JSON.parse(
      await zip.file('docmost-metadata.json').async('string'),
    );
    expect(Object.keys(metadata.pages)).toHaveLength(5);
    expect(
      new Set(Object.values(metadata.pages).map((page: any) => page.pageId))
        .size,
    ).toBe(5);
    const root = await zip.file('Root.md').async('string');
    for (let index = 0; index < titles.length; index++) {
      const [encodedPath] = Object.entries(metadata.pages).find(
        ([, page]: any) => page.pageId === `child-${index}`,
      )!;
      expect(decodeURIComponent(root)).toContain(
        decodeURIComponent(encodedPath),
      );
      const exported = await zip
        .file(decodeURIComponent(encodedPath))
        .async('string');
      expect(exported).toContain(`unique body ${index}`);
    }
    expect(pages.slice(1).map((page) => page.title)).toEqual(titles);
  });
});
