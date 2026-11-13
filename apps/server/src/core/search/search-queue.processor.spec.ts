import { SearchQueueProcessor } from './search-queue.processor';
import { QueueJob } from '../../integrations/queue/constants';

describe('SearchQueueProcessor', () => {
  const id = '019a1f00-0000-7000-8000-000000000001';
  function setup(configured = true) {
    const typesense = {
      syncPages: jest.fn(),
      removeByFilter: jest.fn(),
      reindexBatch: jest.fn(),
    };
    const processor = new SearchQueueProcessor(
      { isTypesenseConfigured: () => configured } as any,
      typesense as any,
    );
    return { processor, typesense };
  }

  it.each([
    QueueJob.PAGE_UPDATED,
    QueueJob.PAGE_RESTORED,
    QueueJob.PAGE_SOFT_DELETED,
    QueueJob.PAGE_DELETED,
  ])(
    'synchronizes current database state for %s, including delayed deletion events',
    async (name) => {
      const { processor, typesense } = setup();
      await processor.process({ name, data: { pageIds: [id] } } as any);
      expect(typesense.syncPages).toHaveBeenCalledWith([id]);
      expect(typesense.removeByFilter).not.toHaveBeenCalled();
    },
  );

  it('requires created pages to be committed before indexing succeeds', async () => {
    const { processor, typesense } = setup();
    await processor.process({
      name: QueueJob.PAGE_CREATED,
      data: { pageIds: [id] },
    } as any);
    expect(typesense.syncPages).toHaveBeenCalledWith([id], true);
  });

  it.each([
    [QueueJob.SPACE_DELETED, 'spaceId'],
    [QueueJob.WORKSPACE_DELETED, 'workspaceId'],
  ])('removes the scope for %s', async (name, field) => {
    const { processor, typesense } = setup();
    await processor.process({ name, data: { [field]: id } } as any);
    expect(typesense.removeByFilter).toHaveBeenCalledWith(`${field}:=${id}`);
  });

  it('continues keyset backfills from the queued cursor', async () => {
    const { processor, typesense } = setup();
    await processor.process({
      name: QueueJob.SEARCH_INDEX_PAGES,
      data: { cursor: id, workspaceId: id },
    } as any);
    expect(typesense.reindexBatch).toHaveBeenCalledWith(id, id);
  });

  it('leaves Typesense untouched when it is not configured', async () => {
    const { processor, typesense } = setup(false);
    await processor.process({
      name: QueueJob.PAGE_UPDATED,
      data: { pageIds: [id] },
    } as any);
    expect(typesense.syncPages).not.toHaveBeenCalled();
  });
});
