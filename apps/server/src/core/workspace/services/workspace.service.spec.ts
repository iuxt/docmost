import { WorkspaceService } from './workspace.service';
import { UserRole } from '../../../common/helpers/types/permission';
import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { QueueJob } from '../../../integrations/queue/constants';

const workspaceId = 'workspace-1';
const userId = 'user-1';
const authUser = { id: 'admin-1', role: UserRole.ADMIN } as any;

function buildService(config: Record<string, string> = {}, settings = {}) {
  const trx = {
    deleteFrom: jest.fn(() => ({
      where: jest.fn(() => ({ execute: jest.fn() })),
    })),
  };
  const db = {
    transaction: () => ({ execute: (cb: (t: any) => any) => cb(trx) }),
  };
  let workspace = { id: workspaceId, settings };
  const workspaceRepo = {
    findById: jest.fn(async () => workspace),
    updateWorkspace: jest.fn(),
    updateSearchDriver: jest.fn(async (_id, driver) => {
      workspace = {
        ...workspace,
        settings: { ...workspace.settings, searchDriver: driver },
      };
    }),
  };
  const environment = new EnvironmentService(new ConfigService(config));
  const searchQueue = { add: jest.fn() };
  const auditService = { log: jest.fn() };
  const userRepo = {
    findById: jest.fn().mockResolvedValue({
      id: userId,
      role: UserRole.MEMBER,
      deactivatedAt: null,
      deletedAt: null,
    }),
    updateUser: jest.fn(),
  };
  const repoDeletingByUser = () => ({
    deleteByUserAndWorkspace: jest.fn(),
  });
  const userSessionRepo = { revokeByUserId: jest.fn() };
  const integrationConnectionRepo = { deleteUserConnections: jest.fn() };

  const service = new WorkspaceService(
    workspaceRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    userRepo as any,
    environment,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    repoDeletingByUser() as any,
    repoDeletingByUser() as any,
    db as any,
    { add: jest.fn() } as any,
    {} as any,
    {} as any,
    auditService as any,
    userSessionRepo as any,
    integrationConnectionRepo as any,
    { disconnectUser: jest.fn() } as any,
    { recheckAccess: jest.fn() } as any,
    searchQueue as any,
  );

  return {
    service,
    trx,
    integrationConnectionRepo,
    workspaceRepo,
    searchQueue,
    auditService,
  };
}

describe('WorkspaceService user offboarding', () => {
  it('deletes personal integration connections on deactivation', async () => {
    const { service, trx, integrationConnectionRepo } = buildService();

    await service.deactivateUser(authUser, userId, workspaceId);

    expect(
      integrationConnectionRepo.deleteUserConnections,
    ).toHaveBeenCalledWith(userId, trx);
  });

  it('deletes personal integration connections on deletion', async () => {
    const { service, trx, integrationConnectionRepo } = buildService();

    await service.deleteUser(authUser, userId, workspaceId);

    expect(
      integrationConnectionRepo.deleteUserConnections,
    ).toHaveBeenCalledWith(userId, trx);
  });
});

describe('WorkspaceService search settings', () => {
  it('persists the workspace driver and queues scoped indexing after commit', async () => {
    const { service, workspaceRepo, searchQueue, trx, auditService } =
      buildService(
        { TYPESENSE_API_KEY: 'server-key' },
        { defaultLocale: 'zh-CN' },
      );
    const result = await service.update(workspaceId, {
      searchDriver: 'typesense',
    } as any);
    expect(workspaceRepo.updateSearchDriver).toHaveBeenCalledWith(
      workspaceId,
      'typesense',
      trx,
    );
    expect(workspaceRepo.updateWorkspace).toHaveBeenCalledWith(
      {},
      workspaceId,
      trx,
    );
    expect(result.settings).toEqual({
      defaultLocale: 'zh-CN',
      searchDriver: 'typesense',
    });
    expect(result.searchDriver).toBe('typesense');
    expect(result.typesenseConfigured).toBe(true);
    expect(searchQueue.add).toHaveBeenCalledWith(
      QueueJob.SEARCH_INDEX_PAGES,
      { workspaceId },
      expect.objectContaining({ attempts: 5 }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        changes: {
          before: { searchDriver: 'database' },
          after: { searchDriver: 'typesense' },
        },
      }),
    );
  });

  it('rejects enabling Typesense without server configuration before changing settings', async () => {
    const { service, workspaceRepo, searchQueue } = buildService();
    await expect(
      service.update(workspaceId, { searchDriver: 'typesense' } as any),
    ).rejects.toThrow('Typesense is not configured');
    expect(workspaceRepo.updateSearchDriver).not.toHaveBeenCalled();
    expect(searchQueue.add).not.toHaveBeenCalled();
  });

  it('allows disabling Typesense after server configuration has been removed', async () => {
    const { service, searchQueue } = buildService(
      {},
      { searchDriver: 'typesense' },
    );
    const result = await service.update(workspaceId, {
      searchDriver: 'database',
    } as any);
    expect(result.searchDriver).toBe('database');
    expect(result.typesenseConfigured).toBe(false);
    expect(searchQueue.add).not.toHaveBeenCalled();
  });

  it('does not enqueue another backfill when saving the same driver', async () => {
    const { service, searchQueue } = buildService(
      { TYPESENSE_API_KEY: 'key' },
      { searchDriver: 'typesense' },
    );
    await service.update(workspaceId, { searchDriver: 'typesense' } as any);
    expect(searchQueue.add).not.toHaveBeenCalled();
  });

  it('returns the inherited driver and availability in workspace info', async () => {
    const { service } = buildService({
      SEARCH_DRIVER: 'typesense',
      TYPESENSE_API_KEY: 'key',
    });
    expect(await service.getWorkspaceInfo(workspaceId)).toMatchObject({
      searchDriver: 'typesense',
      typesenseConfigured: true,
    });
  });
});
