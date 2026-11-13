import { PersistenceExtension } from './persistence.extension';
import { TiptapTransformer } from '@hocuspocus/transformer';
import { tiptapExtensions } from '../collaboration.util';

describe('PersistenceExtension trash protection', () => {
  it('keeps edits buffered before deletion so restoring does not lose them', async () => {
    const deletedAt = new Date();
    const pageRepo = {
      findById: jest.fn(async () => ({
        id: 'page',
        deletedAt,
        createdAt: new Date(0),
        creatorId: 'user',
        content: { type: 'doc', content: [{ type: 'paragraph' }] },
      })),
      updatePage: jest.fn(),
    };
    const db = { transaction: () => ({ execute: (fn: any) => fn({}) }) };
    const persistence = new PersistenceExtension(
      pageRepo as any,
      db as any,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      { add: jest.fn() } as any,
      { addContributors: jest.fn() } as any,
      {
        syncPageTransclusions: jest.fn(),
        syncPageReferences: jest.fn(),
      } as any,
      { invalidateForEdit: jest.fn(async () => null) } as any,
    );
    const document = TiptapTransformer.toYdoc(
      {
        type: 'doc',
        content: [
          {
            type: 'paragraph',
            content: [{ type: 'text', text: 'last edit before trash' }],
          },
        ],
      },
      'default',
      tiptapExtensions,
    );
    Object.assign(document, { broadcastStateless: jest.fn() });
    const time = jest
      .spyOn(Date, 'now')
      .mockReturnValue(deletedAt.getTime() - 1000);
    try {
      await persistence.onChange({
        documentName: 'page.page',
        context: { user: { id: 'user' } },
      } as any);
    } finally {
      time.mockRestore();
    }
    try {
      await persistence.onStoreDocument({
        documentName: 'page.page',
        document,
        lastContext: { user: { id: 'user' } },
      } as any);
      expect(pageRepo.updatePage).toHaveBeenCalledWith(
        expect.objectContaining({
          textContent: expect.stringContaining('last edit before trash'),
        }),
        'page',
        expect.anything(),
      );
    } finally {
      document.destroy();
    }
  });
  it('does not persist a buffered edit after the page is trashed', async () => {
    const pageRepo = {
      findById: jest.fn(async () => ({ id: 'page', deletedAt: new Date() })),
      updatePage: jest.fn(),
    };
    const history = { add: jest.fn() };
    const db = { transaction: () => ({ execute: (fn: any) => fn({}) }) };
    const persistence = new PersistenceExtension(
      pageRepo as any,
      db as any,
      {} as any,
      history as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
    const document = TiptapTransformer.toYdoc(
      {
        type: 'doc',
        content: [
          { type: 'paragraph', content: [{ type: 'text', text: 'late edit' }] },
        ],
      },
      'default',
      tiptapExtensions,
    );
    try {
      await persistence.onStoreDocument({
        documentName: 'page.page',
        document,
        lastContext: { user: { id: 'user' } },
      } as any);
      expect(pageRepo.findById).toHaveBeenCalledWith(
        'page',
        expect.objectContaining({ withLock: true }),
      );
      expect(pageRepo.updatePage).not.toHaveBeenCalled();
      expect(history.add).not.toHaveBeenCalled();
    } finally {
      document.destroy();
    }
  });
});
