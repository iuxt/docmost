import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { SearchController } from './search.controller';

// Keep controller tests independent of each service's application dependencies.
jest.mock('./search.service', () => ({ SearchService: class {} }));
jest.mock('./typesense-search.service', () => ({
  TypesenseSearchService: class {},
}));
jest.mock('../casl/abilities/space-ability.factory', () => ({
  __esModule: true,
  default: class {},
}));
jest.mock('../../common/guards/jwt-auth.guard', () => ({
  JwtAuthGuard: class {},
}));
jest.mock('../public-space/public-space.service', () => ({
  PublicSpaceService: class {},
}));
jest.mock('@docmost/db/repos/page/page.repo', () => ({ PageRepo: class {} }));
jest.mock('../share/share.service', () => ({ ShareService: class {} }));
jest.mock('@docmost/db/repos/share/share.repo', () => ({
  ShareRepo: class {},
}));

describe('SearchController', () => {
  let controller: SearchController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('routes Typesense searches to the bundled provider with the authenticated scope', async () => {
    const typesense = {
      searchPage: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new SearchController(
      {} as any,
      {} as any,
      { getSearchDriver: () => 'typesense' } as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      typesense as any,
    );
    await controller.pageSearch(
      { query: '中文', shareId: 'injected-share' } as any,
      { id: 'user-1' } as any,
      { id: 'workspace-1' } as any,
    );
    expect(typesense.searchPage).toHaveBeenCalledWith(
      { query: '中文' },
      { userId: 'user-1', workspaceId: 'workspace-1' },
    );
  });
});

describe('SearchController public-space-search gate', () => {
  function makeController(overrides: any = {}) {
    const searchService = { searchPage: jest.fn().mockResolvedValue([]) };
    const environmentService = {
      getSearchDriver: jest.fn().mockReturnValue('postgres'),
    };
    const publicSpaceService = {
      getPublicSpace: jest
        .fn()
        .mockRejectedValue(new NotFoundException('Space not found')),
      ...overrides.publicSpaceService,
    };
    const pageRepo = {
      getSpacePagesExcludingRestricted: jest
        .fn()
        .mockResolvedValue([{ id: 'p1' }, { id: 'p2' }]),
    };
    const controller = new SearchController(
      searchService as any,
      {} as any,
      environmentService as any,
      publicSpaceService as any,
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
    );
    return { controller, searchService, publicSpaceService, pageRepo };
  }

  const workspace = { id: 'ws1' } as any;

  it('does not read pages or search when the public space gate rejects', async () => {
    const { controller, searchService, pageRepo } = makeController();
    await expect(
      controller.searchPublicSpace(
        { query: 'roadmap', spaceSlug: 'handbook' } as any,
        workspace,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageRepo.getSpacePagesExcludingRestricted).not.toHaveBeenCalled();
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('searches only the unrestricted pages of the gated space, ignoring client filters', async () => {
    const { controller, searchService, publicSpaceService, pageRepo } =
      makeController({
        publicSpaceService: {
          getPublicSpace: jest
            .fn()
            .mockResolvedValue({ space: { id: 's1' }, publicSpace: {} }),
        },
      });
    await controller.searchPublicSpace(
      {
        query: 'roadmap',
        spaceSlug: 'handbook',
        spaceId: 'attacker-space',
        shareId: 'share1',
        creatorId: 'u1',
        labelIds: ['l1'],
      } as any,
      workspace,
    );
    expect(publicSpaceService.getPublicSpace).toHaveBeenCalledWith(
      'handbook',
      workspace,
    );
    expect(pageRepo.getSpacePagesExcludingRestricted).toHaveBeenCalledWith(
      's1',
    );
    expect(searchService.searchPage).toHaveBeenCalledWith(
      { query: 'roadmap', spaceSlug: 'handbook' },
      { workspaceId: 'ws1', publicPageIds: ['p1', 'p2'] },
    );
  });
});

describe('SearchController share-search gate', () => {
  const OPEN_SPACE_ID = '019a1f00-0000-7000-8000-00000000000a';
  const CLOSED_SPACE_ID = '019a1f00-0000-7000-8000-00000000000b';

  function makeShare(id: string, key: string, spaceId: string) {
    return {
      id,
      key,
      pageId: '019a1f00-0000-7000-8000-000000000021',
      includeSubPages: true,
      searchIndexing: false,
      creatorId: '019a1f00-0000-7000-8000-000000000031',
      spaceId,
      workspaceId: 'ws1',
      createdAt: new Date('2026-11-01T00:00:00Z'),
      updatedAt: new Date('2026-11-01T00:00:00Z'),
      deletedAt: null,
    };
  }

  const shares = [
    makeShare('019a1f00-0000-7000-8000-000000000011', 'openkey', OPEN_SPACE_ID),
    makeShare(
      '019a1f00-0000-7000-8000-000000000012',
      'closedkey',
      CLOSED_SPACE_ID,
    ),
  ];

  function makeController(driver = 'postgres') {
    const searchService = {
      searchPage: jest.fn().mockResolvedValue({ items: [] }),
    };
    const environmentService = {
      getSearchDriver: jest.fn().mockReturnValue(driver),
    };
    const shareService = {
      isSharingAllowed: jest.fn(
        async (workspaceId: string, spaceId: string) =>
          workspaceId === 'ws1' && spaceId === OPEN_SPACE_ID,
      ),
    };
    const shareRepo = {
      findById: jest.fn(async (shareId: string) =>
        shares.find((share) => share.id === shareId || share.key === shareId),
      ),
    };
    const controller = new SearchController(
      searchService as any,
      {} as any,
      environmentService as any,
      {} as any,
      {} as any,
      shareService as any,
      shareRepo as any,
      {} as any,
    );
    const searchTypesense = jest
      .spyOn(controller, 'searchTypesense')
      .mockResolvedValue({ items: [] });
    return { controller, searchService, searchTypesense };
  }

  const workspace = { id: 'ws1' } as any;

  it.each(['postgres', 'typesense'])(
    'rejects a share whose space has public sharing disabled (%s)',
    async (driver) => {
      const { controller, searchService, searchTypesense } =
        makeController(driver);

      await expect(
        controller.searchShare(
          { query: 'orbital', shareId: 'closedkey' } as any,
          workspace,
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(searchService.searchPage).not.toHaveBeenCalled();
      expect(searchTypesense).not.toHaveBeenCalled();
    },
  );

  it('rejects an unknown share', async () => {
    const { controller, searchService } = makeController();

    await expect(
      controller.searchShare(
        { query: 'orbital', shareId: 'missingkey' } as any,
        workspace,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(searchService.searchPage).not.toHaveBeenCalled();
  });

  it('searches a share whose space allows public sharing', async () => {
    const { controller, searchService } = makeController();

    await controller.searchShare(
      { query: 'orbital', shareId: 'openkey', spaceId: OPEN_SPACE_ID } as any,
      workspace,
    );

    expect(searchService.searchPage).toHaveBeenCalledWith(
      { query: 'orbital', shareId: 'openkey' },
      { workspaceId: 'ws1' },
    );
  });
});
