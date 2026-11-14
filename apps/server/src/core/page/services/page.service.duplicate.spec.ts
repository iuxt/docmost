import { PageService } from './page.service';

const workspaceId = '019a4f3e-0000-7000-8000-000000000001';
const pageId = '019a4f3e-0000-7000-8000-000000000002';
const attachmentId = '019a4f3e-0000-7000-8000-000000000003';

describe('PageService duplicated attachments', () => {
  it('does not insert a sibling copy under a parent that was trashed during copying', async () => {
    const root = {
      id: pageId,
      slugId: 'root',
      workspaceId,
      spaceId: 'space',
      parentPageId: 'parent',
      title: 'Source',
      position: 'a0',
      content: { type: 'doc', content: [{ type: 'paragraph' }] },
    };
    const service = Object.create(PageService.prototype);
    service.pageRepo = {
      getPageAndDescendants: jest.fn(async () => [root]),
      lockPageHierarchySpaces: jest.fn(),
      findById: jest.fn(async () => ({
        id: 'parent',
        workspaceId,
        spaceId: 'space',
        deletedAt: new Date(),
      })),
    };
    service.filterAccessibleTreePages = jest.fn(async () => [root]);
    service.pagePermissionRepo = {};
    const insert = jest.fn();
    service.db = {
      transaction: () => ({
        execute: (callback: any) => callback({ insertInto: insert }),
      }),
    };
    await expect(
      service.duplicatePage(root, undefined, { id: 'user' }),
    ).rejects.toThrow('Parent page not found');
    expect(insert).not.toHaveBeenCalled();
  });
  it.each([
    ['attachment', 'url'],
    ['image', 'src'],
    ['pdf', 'src'],
  ])('copies a %s with its new id in %s', async (type, urlAttribute) => {
    const originalUrl = `/api/files/${attachmentId}/file.pdf`;
    const originalPath = `${workspaceId}/files/${attachmentId}/file.pdf`;
    const root = {
      id: pageId,
      slugId: 'root',
      workspaceId,
      spaceId: 'source',
      position: 'a0',
      parentPageId: null,
      title: 'Root',
      content: {
        type: 'doc',
        content: [
          {
            type,
            attrs: {
              attachmentId,
              [urlAttribute]: originalUrl,
              name: 'file.pdf',
            },
          },
        ],
      },
    };
    const pages: any[] = [],
      attachments: any[] = [];
    const insertInto = (table: string) => ({
      values: (rows: any) => ({
        execute: async () => {
          (table === 'pages' ? pages : attachments).push(
            ...(Array.isArray(rows) ? rows : [rows]),
          );
        },
      }),
    });
    const service = new PageService(
      {
        getPageAndDescendants: async () => [root],
        findById: async () => root,
        lockPageHierarchySpaces: jest.fn(),
      } as any,
      {
        findRestrictedAncestor: async () => undefined,
        copyRestrictions: async () => 0,
        filterAccessiblePageIds: async () => [pageId],
      } as any,
      {} as any,
      {
        transaction: () => ({ execute: (fn: any) => fn({ insertInto }) }),
        insertInto,
        selectFrom: () => ({
          selectAll: () => ({
            where: () => ({
              where: () => ({
                execute: async () => [
                  {
                    id: attachmentId,
                    pageId,
                    workspaceId,
                    filePath: originalPath,
                    fileName: 'file.pdf',
                  },
                ],
              }),
            }),
          }),
        }),
      } as any,
      { copy: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      { emit: jest.fn() } as any,
      {} as any,
      {} as any,
      {
        insertTransclusionsForPages: jest.fn(),
        insertReferencesForPages: jest.fn(),
      } as any,
      { copyLabelsToPages: jest.fn() } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a1');
    await service.duplicatePage(root as any, 'target', {
      id: 'user',
      workspaceId,
    } as any);
    const attrs = pages[0].content.content[0].attrs;
    expect(attrs.attachmentId).not.toBe(attachmentId);
    expect(attrs[urlAttribute]).toBe(
      `/api/files/${attrs.attachmentId}/file.pdf`,
    );
    expect(attachments).toEqual([
      expect.objectContaining({
        id: attrs.attachmentId,
        pageId: pages[0].id,
        spaceId: 'target',
        filePath: `${workspaceId}/files/${attrs.attachmentId}/file.pdf`,
      }),
    ]);
  });
});
