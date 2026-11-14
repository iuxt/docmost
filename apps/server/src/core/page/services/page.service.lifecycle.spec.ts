import { PageService } from './page.service';

describe('Page lifecycle collaboration notifications', () => {
  it('does not queue attachment deletion when permanent deletion rolls back', async () => {
    const service = Object.create(PageService.prototype);
    service.pageRepo = {
      deletePageTree: jest.fn().mockRejectedValue(new Error('rollback')),
    };
    service.attachmentQueue = { add: jest.fn() };
    service.eventEmitter = { emit: jest.fn() };
    await expect(service.forceDelete('page', 'workspace')).rejects.toThrow(
      'rollback',
    );
    expect(service.attachmentQueue.add).not.toHaveBeenCalled();
    expect(service.eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('only queues file cleanup for pages deleted by the committed transaction', async () => {
    const service = Object.create(PageService.prototype);
    const steps: string[] = [];
    service.pageRepo = {
      deletePageTree: jest.fn(async () => {
        steps.push('commit');
        return ['page', 'child'];
      }),
    };
    service.attachmentQueue = {
      add: jest.fn(async () => {
        steps.push('cleanup');
      }),
    };
    service.eventEmitter = { emit: jest.fn() };
    await service.forceDelete('page', 'workspace');
    expect(steps).toEqual(['commit', 'cleanup', 'cleanup']);
    expect(
      service.attachmentQueue.add.mock.calls.map(
        (call: any[]) => call[1].pageId,
      ),
    ).toEqual(['page', 'child']);
  });

  it('rejects malformed content before modifying metadata or scheduling side effects', async () => {
    const service = Object.create(PageService.prototype);
    service.pageRepo = { updatePage: jest.fn() };
    service.db = { transaction: jest.fn() };
    service.generalQueue = { add: jest.fn() };
    await expect(
      service.update(
        { id: 'page', contributorIds: [], title: 'Original' },
        {
          title: 'Changed',
          content: { type: 'doesNotExist' },
          operation: 'replace',
          format: 'json',
        },
        { id: 'user' },
      ),
    ).rejects.toThrow('Invalid content format');
    expect(service.db.transaction).not.toHaveBeenCalled();
    expect(service.pageRepo.updatePage).not.toHaveBeenCalled();
    expect(service.generalQueue.add).not.toHaveBeenCalled();
  });
  it.each(['removePage', 'restorePage'] as const)(
    '%s rechecks access after the database operation completes',
    async (operation) => {
      const steps: string[] = [];
      const service = Object.create(PageService.prototype);
      service.pageRepo = {
        [operation]: jest.fn(async () => {
          steps.push('database');
        }),
      };
      service.collabAccessService = {
        recheckAccess: jest.fn(async () => {
          steps.push('recheck');
        }),
      };
      if (operation === 'removePage')
        await service.removePage('page', 'user', 'workspace');
      else await service.restorePage('page', 'workspace');
      expect(steps).toEqual(['database', 'recheck']);
      expect(service.collabAccessService.recheckAccess).toHaveBeenCalledWith({
        pageIds: ['page'],
      });
    },
  );

  it('does not announce a deletion that failed', async () => {
    const service = Object.create(PageService.prototype);
    service.pageRepo = {
      removePage: jest.fn(async () => {
        throw new Error('rollback');
      }),
    };
    service.collabAccessService = { recheckAccess: jest.fn() };
    await expect(
      service.removePage('page', 'user', 'workspace'),
    ).rejects.toThrow('rollback');
    expect(service.collabAccessService.recheckAccess).not.toHaveBeenCalled();
  });
});
