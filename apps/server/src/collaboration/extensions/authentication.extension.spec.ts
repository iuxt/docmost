import { Forbidden } from '@hocuspocus/common';
import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import { AuthenticationExtension } from './authentication.extension';
import { COLLAB_ACCESS_RECHECK_CHANNEL } from '../constants';

const WRITER = [{ userId: 'any', role: 'writer' }];
const READER = [{ userId: 'any', role: 'reader' }];
const NO_ACCESS = JSON.stringify({ type: 'page.permissions', access: 'none' });
const READ_ACCESS = JSON.stringify({
  type: 'page.permissions',
  access: 'read',
});

function makeConnection(userId: string) {
  return {
    context: {
      user: { id: userId, workspaceId: 'ws_1' },
      sessionId: `session_${userId}`,
    },
    readOnly: false,
    close: jest.fn(),
    sendStateless: jest.fn(),
  };
}

async function makeExtension(
  spaceRoles: Record<string, unknown[] | undefined>,
  documents: Record<string, ReturnType<typeof makeConnection>[]> = {},
) {
  const subscriber = {
    on: jest.fn(),
    subscribe: jest.fn(async () => undefined),
    disconnect: jest.fn(),
  };
  const spaceMemberRepo = {
    getUserSpaceRoles: jest.fn(async (userId: string) => spaceRoles[userId]),
  };
  const pagePermissionRepo = {
    canUserEditPage: jest.fn(async () => ({
      hasAnyRestriction: false,
      canAccess: true,
      canEdit: true,
    })),
  };
  const userSessionRepo = {
    findActiveById: jest.fn(async (id: string) => ({
      userId: id.replace('session_', ''),
      workspaceId: 'ws_1',
    })),
  };
  const tokenService = {
    verifyJwt: jest.fn(async (token: string) => ({
      sub: token,
      workspaceId: 'ws_1',
      sessionId: `session_${token}`,
    })),
  };
  const pageRepo = {
    findById: jest.fn(async (id: string) => ({
      id,
      spaceId: 'space_1',
      workspaceId: id === 'page_other_ws' ? 'ws_2' : 'ws_1',
      deletedAt: null as Date | null,
    })),
    getPageAndDescendants: jest.fn(async (id: string) => [
      { id },
      { id: 'child_page' },
    ]),
  };
  const extension = new AuthenticationExtension(
    tokenService as any,
    {
      findById: jest.fn(async (id: string) => {
        if (id === 'user_broken') throw new Error('db down');
        return { id, workspaceId: 'ws_1' };
      }),
    } as any,
    pageRepo as any,
    spaceMemberRepo as any,
    pagePermissionRepo as any,
    { getOrThrow: () => ({ duplicate: () => subscriber }) } as any,
    userSessionRepo as any,
  );
  const instance = {
    documents: new Map(
      Object.entries(documents).map(([name, connections]) => [
        name,
        { name, getConnections: () => connections },
      ]),
    ),
  };
  await extension.onConfigure({ instance } as any);
  return {
    extension,
    subscriber,
    spaceMemberRepo,
    pagePermissionRepo,
    userSessionRepo,
    pageRepo,
    tokenService,
  };
}

describe('AuthenticationExtension access recheck', () => {
  it('closes connections of users who lost access and leaves others alone', async () => {
    const removed = makeConnection('user_removed');
    const other = makeConnection('user_other');
    const { extension } = await makeExtension(
      { user_removed: undefined, user_other: WRITER },
      { 'page.page_1': [removed, other] },
    );

    await extension.recheckAccess({ userIds: ['user_removed'] });

    expect(removed.sendStateless).toHaveBeenCalledWith(NO_ACCESS);
    expect(removed.readOnly).toBe(true);
    expect(removed.close).toHaveBeenCalledWith(Forbidden);
    expect(other.sendStateless).not.toHaveBeenCalled();
    expect(other.close).not.toHaveBeenCalled();
  });

  it('makes downgraded editors read-only without closing them', async () => {
    const downgraded = makeConnection('user_reader');
    const { extension } = await makeExtension(
      { user_reader: READER },
      { 'page.page_1': [downgraded] },
    );

    await extension.recheckAccess({ userIds: ['user_reader'] });

    expect(downgraded.readOnly).toBe(true);
    expect(downgraded.sendStateless).toHaveBeenCalledWith(READ_ACCESS);
    expect(downgraded.close).not.toHaveBeenCalled();
  });

  it('rechecks connections on pages under a changed page only', async () => {
    const underChangedPage = makeConnection('user_1');
    const elsewhere = makeConnection('user_1');
    const { extension, spaceMemberRepo } = await makeExtension(
      { user_1: undefined },
      { 'page.child_page': [underChangedPage], 'page.other_page': [elsewhere] },
    );

    await extension.recheckAccess({ pageIds: ['page_1'] });

    expect(underChangedPage.close).toHaveBeenCalledWith(Forbidden);
    expect(elsewhere.close).not.toHaveBeenCalled();
    expect(spaceMemberRepo.getUserSpaceRoles).toHaveBeenCalledWith(
      'user_1',
      'space_1',
      { skipCache: true },
    );
  });

  it('rechecks when an access message arrives on the channel', async () => {
    const removed = makeConnection('user_removed');
    const { subscriber } = await makeExtension(
      { user_removed: undefined },
      { 'page.page_1': [removed] },
    );
    const handler = (name: string) =>
      subscriber.on.mock.calls.find(([event]) => event === name)[1];

    expect(subscriber.on).toHaveBeenCalledWith('error', expect.any(Function));
    handler('ready')();
    handler('ready')();
    expect(subscriber.subscribe).toHaveBeenCalledTimes(2);
    expect(subscriber.subscribe).toHaveBeenCalledWith(
      COLLAB_ACCESS_RECHECK_CHANNEL,
    );
    const onMessage = handler('message');
    await onMessage(
      COLLAB_ACCESS_RECHECK_CHANNEL,
      JSON.stringify({ userIds: ['user_removed'] }),
    );

    expect(removed.close).toHaveBeenCalledWith(Forbidden);
  });

  it('keeps rechecking after one connection fails', async () => {
    const broken = makeConnection('user_broken');
    const removed = makeConnection('user_removed');
    const { extension } = await makeExtension(
      { user_removed: undefined },
      { 'page.page_1': [broken, removed] },
    );

    await extension.recheckAccess({ userIds: ['user_broken', 'user_removed'] });

    expect(broken.close).not.toHaveBeenCalled();
    expect(removed.close).toHaveBeenCalledWith(Forbidden);
  });
});

describe('AuthenticationExtension onAuthenticate', () => {
  it('checks permissions without the cache', async () => {
    const { extension, spaceMemberRepo, pagePermissionRepo } =
      await makeExtension({ user_reader: READER });

    await extension.onAuthenticate({
      documentName: 'page.page_1',
      token: 'user_reader',
      connectionConfig: { readOnly: false },
    } as any);

    expect(spaceMemberRepo.getUserSpaceRoles).toHaveBeenCalledWith(
      'user_reader',
      'space_1',
      { skipCache: true },
    );
    expect(pagePermissionRepo.canUserEditPage).toHaveBeenCalledWith(
      'user_reader',
      'page_1',
      { skipCache: true },
    );
  });

  it('opens readers read-only and rejects users without access', async () => {
    const { extension } = await makeExtension({
      user_reader: READER,
      user_none: undefined,
    });
    const payload = (token: string) =>
      ({
        documentName: 'page.page_1',
        token,
        connectionConfig: { readOnly: false },
      }) as any;

    const readerPayload = payload('user_reader');
    await extension.onAuthenticate(readerPayload);
    expect(readerPayload.connectionConfig.readOnly).toBe(true);

    await expect(
      extension.onAuthenticate(payload('user_none')),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects pages from another workspace', async () => {
    const { extension, spaceMemberRepo } = await makeExtension({
      user_writer: WRITER,
    });

    await expect(
      extension.onAuthenticate({
        documentName: 'page.page_other_ws',
        token: 'user_writer',
        connectionConfig: { readOnly: false },
      } as any),
    ).rejects.toThrow(NotFoundException);
    expect(spaceMemberRepo.getUserSpaceRoles).not.toHaveBeenCalled();
  });
});

describe('Collaboration session and deletion protection', () => {
  it('restores write access on an existing connection after the page is restored', async () => {
    const connection = makeConnection('user_writer');
    connection.readOnly = true;
    const { extension } = await makeExtension(
      { user_writer: WRITER },
      { 'page.page_1': [connection] },
    );
    await extension.recheckAccess({ pageIds: ['page_1'] });
    expect(connection.readOnly).toBe(false);
    expect(connection.sendStateless).toHaveBeenCalledWith(
      JSON.stringify({ type: 'page.permissions', access: 'write' }),
    );
  });
  it.each([
    ['revoked', undefined],
    ['different user', { userId: 'other', workspaceId: 'ws_1' }],
    ['different workspace', { userId: 'user_writer', workspaceId: 'other' }],
  ])('rejects a %s session on reconnect', async (_label, session) => {
    const { extension, userSessionRepo } = await makeExtension({
      user_writer: WRITER,
    });
    userSessionRepo.findActiveById.mockResolvedValue(session);
    await expect(
      extension.onAuthenticate({
        documentName: 'page.page_1',
        token: 'user_writer',
        connectionConfig: {},
      } as any),
    ).rejects.toThrow(UnauthorizedException);
  });

  it('rejects legacy tokens without a session', async () => {
    const { extension, tokenService, userSessionRepo } = await makeExtension({
      user_writer: WRITER,
    });
    tokenService.verifyJwt.mockResolvedValue({
      sub: 'user_writer',
      workspaceId: 'ws_1',
      sessionId: undefined,
    });
    await expect(
      extension.onAuthenticate({
        documentName: 'page.page_1',
        token: 'user_writer',
        connectionConfig: {},
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect(userSessionRepo.findActiveById).not.toHaveBeenCalled();
  });

  it('closes a revoked session while preserving another session of the same user', async () => {
    const revoked = makeConnection('user_writer');
    const current = makeConnection('user_writer');
    current.context.sessionId = 'current';
    const { extension, userSessionRepo } = await makeExtension(
      { user_writer: WRITER },
      { 'page.page_1': [revoked, current] },
    );
    userSessionRepo.findActiveById.mockImplementation(async (id) =>
      id === 'current'
        ? { userId: 'user_writer', workspaceId: 'ws_1' }
        : undefined,
    );
    await extension.recheckAccess({ userIds: ['user_writer'] });
    expect(revoked.close).toHaveBeenCalledWith(Forbidden);
    expect(current.close).not.toHaveBeenCalled();
  });

  it('rechecks deleted descendants and makes already open editors read-only', async () => {
    const connection = makeConnection('user_writer');
    const { extension, pageRepo } = await makeExtension(
      { user_writer: WRITER },
      { 'page.child_page': [connection] },
    );
    pageRepo.findById.mockResolvedValue({
      id: 'child_page',
      spaceId: 'space_1',
      workspaceId: 'ws_1',
      deletedAt: new Date(),
    });
    await extension.recheckAccess({ pageIds: ['page_1'] });
    expect(pageRepo.getPageAndDescendants).toHaveBeenCalledWith('page_1', {
      includeContent: false,
      includeDeleted: true,
    });
    expect(connection.readOnly).toBe(true);
    expect(connection.sendStateless).toHaveBeenCalledWith(READ_ACCESS);
  });

  it('blocks an incoming message from a revoked session even without a pubsub message', async () => {
    const connection = makeConnection('user_writer');
    const { extension, userSessionRepo } = await makeExtension({
      user_writer: WRITER,
    });
    userSessionRepo.findActiveById.mockResolvedValue(undefined);
    await expect(
      extension.beforeHandleMessage({
        connection,
        documentName: 'page.page_1',
      } as any),
    ).rejects.toThrow(UnauthorizedException);
    expect(connection.close).toHaveBeenCalledWith(Forbidden);
  });

  it('downgrades an incoming write before a deletion broadcast arrives', async () => {
    const connection = makeConnection('user_writer');
    const { extension, pageRepo } = await makeExtension({
      user_writer: WRITER,
    });
    pageRepo.findById.mockResolvedValue({
      id: 'page_1',
      spaceId: 'space_1',
      workspaceId: 'ws_1',
      deletedAt: new Date(),
    });
    await extension.beforeHandleMessage({
      connection,
      documentName: 'page.page_1',
    } as any);
    expect(connection.readOnly).toBe(true);
  });
});
