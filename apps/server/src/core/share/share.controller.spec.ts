import { NotFoundException } from '@nestjs/common';
import { ShareController } from './share.controller';

describe('Anonymous share metadata', () => {
  const workspace = { id: 'workspace' } as any;
  const page = {
    id: 'page',
    slugId: 'slug',
    title: 'Public title',
    workspaceId: 'workspace',
    spaceId: 'space',
  };
  const share = {
    id: 'share',
    key: 'public-key',
    pageId: 'page',
    workspaceId: 'workspace',
    spaceId: 'space',
    creatorId: 'private-user-id',
  };

  function setup() {
    const controller = Object.create(ShareController.prototype);
    controller.shareRepo = { findById: jest.fn(async () => share) };
    controller.pageRepo = { findById: jest.fn(async () => page) };
    controller.pagePermissionRepo = {
      hasRestrictedAncestor: jest.fn(async () => false),
    };
    controller.shareService = { isSharingAllowed: jest.fn(async () => true) };
    return controller;
  }

  it('returns only the fields needed for the public redirect', async () => {
    const controller = setup();
    expect(
      await controller.getShare({ shareId: 'public-key' }, workspace),
    ).toEqual({
      key: 'public-key',
      sharedPage: { slugId: 'slug', title: 'Public title' },
    });
  });

  it('hides shares in another workspace', async () => {
    const controller = setup();
    await expect(
      controller.getShare({ shareId: 'public-key' }, { id: 'other' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(controller.pageRepo.findById).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', null],
    ['deleted', { ...page, deletedAt: new Date() }],
    ['moved to another space', { ...page, spaceId: 'other-space' }],
    ['in another workspace', { ...page, workspaceId: 'other-workspace' }],
  ])('hides a page that is %s', async (_, value) => {
    const controller = setup();
    controller.pageRepo.findById.mockResolvedValue(value);
    await expect(
      controller.getShare({ shareId: 'public-key' }, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides a page restricted directly or by an ancestor', async () => {
    const controller = setup();
    controller.pagePermissionRepo.hasRestrictedAncestor.mockResolvedValue(true);
    await expect(
      controller.getShare({ shareId: 'public-key' }, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('hides metadata when workspace or space sharing is disabled', async () => {
    const controller = setup();
    controller.shareService.isSharingAllowed.mockResolvedValue(false);
    await expect(
      controller.getShare({ shareId: 'public-key' }, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
