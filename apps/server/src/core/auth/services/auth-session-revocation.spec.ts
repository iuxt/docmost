import { AuthService } from './auth.service';
import { hashPassword } from '../../../common/helpers';
import { UserTokenType } from '../auth.constants';

describe('Password changes revoke collaboration sessions', () => {
  let password: string;
  beforeAll(async () => {
    password = await hashPassword('old-password');
  });

  function setup() {
    const user = {
      id: 'user',
      workspaceId: 'workspace',
      name: 'User',
      email: 'user@example.test',
      password,
    };
    const trx = {
      deleteFrom: () => ({
        where: () => ({ where: () => ({ execute: jest.fn() }) }),
      }),
    };
    const ws = {
      disconnectOtherSessions: jest.fn(),
      disconnectUser: jest.fn(),
    };
    const collab = { recheckAccess: jest.fn() };
    const sessions = {
      deleteAllExceptCurrent: jest.fn(),
      deleteByUserId: jest.fn(),
    };
    const service = new AuthService(
      {} as any,
      {} as any,
      { createSessionAndToken: jest.fn() } as any,
      sessions as any,
      { findById: async () => user, updateUser: jest.fn() } as any,
      {
        findById: async () => ({
          userId: 'user',
          type: UserTokenType.FORGOT_PASSWORD,
          expiresAt: new Date(Date.now() + 60000),
        }),
      } as any,
      { sendToQueue: jest.fn() } as any,
      {} as any,
      { isCloud: () => false } as any,
      { emitAsync: jest.fn() } as any,
      { transaction: () => ({ execute: (fn: any) => fn(trx) }) } as any,
      { log: jest.fn(), setActorId: jest.fn() } as any,
      ws as any,
      collab as any,
    );
    return { service, ws, collab, sessions };
  }

  it('rechecks collaboration after changing a password while keeping the current session', async () => {
    const { service, collab, sessions } = setup();
    await service.changePassword(
      { oldPassword: 'old-password', newPassword: 'new-password' } as any,
      'user',
      'workspace',
      'current',
    );
    expect(sessions.deleteAllExceptCurrent).toHaveBeenCalledWith(
      'current',
      'user',
      'workspace',
    );
    expect(collab.recheckAccess).toHaveBeenCalledWith({ userIds: ['user'] });
  });

  it('rechecks collaboration after a password reset removes every old session', async () => {
    const { service, collab, sessions } = setup();
    await service.passwordReset(
      { token: 'reset-token', newPassword: 'new-password' } as any,
      { id: 'workspace' } as any,
    );
    expect(sessions.deleteByUserId).toHaveBeenCalledWith('user', 'workspace');
    expect(collab.recheckAccess).toHaveBeenCalledWith({ userIds: ['user'] });
  });
});
