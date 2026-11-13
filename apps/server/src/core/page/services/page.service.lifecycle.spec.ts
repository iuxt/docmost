import { PageService } from './page.service';

describe('Page lifecycle collaboration notifications', () => {
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
