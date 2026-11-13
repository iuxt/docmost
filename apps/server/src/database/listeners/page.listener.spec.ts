import { PageListener } from './page.listener';
import { QueueJob } from '../../integrations/queue/constants';

describe('Page indexing events', () => {
  it('queues updates even when the update event has no workspace ID', async () => {
    // PageRepo.updatePages often changes only title/content, so the event has no workspaceId.
    const config = { isConfigured: jest.fn() };
    const searchQueue = { add: jest.fn() };
    const listener = new PageListener(
      config as any,
      searchQueue as any,
      {} as any,
    );
    await listener.handlePageUpdated({ pageIds: ['page-id'] } as any);
    expect(config.isConfigured).not.toHaveBeenCalled();
    expect(searchQueue.add).toHaveBeenCalledWith(
      QueueJob.PAGE_UPDATED,
      { pageIds: ['page-id'], workspaceId: undefined },
      { delay: 1000 },
    );
  });

  it('keeps workspace scope when permanently deleted pages are no longer in the database', async () => {
    const config = { isConfigured: jest.fn().mockResolvedValue(true) };
    const searchQueue = { add: jest.fn() };
    const aiQueue = { add: jest.fn() };
    const listener = new PageListener(
      config as any,
      searchQueue as any,
      aiQueue as any,
    );
    await listener.handlePageDeleted({
      pageIds: ['deleted-id'],
      workspaceId: 'workspace-id',
    });
    expect(searchQueue.add).toHaveBeenCalledWith(QueueJob.PAGE_DELETED, {
      pageIds: ['deleted-id'],
      workspaceId: 'workspace-id',
    });
    expect(aiQueue.add).toHaveBeenCalledWith(QueueJob.PAGE_DELETED, {
      pageIds: ['deleted-id'],
      workspaceId: 'workspace-id',
    });
  });
});
