import { TypesenseSearchService } from './typesense-search.service';

jest.mock('./search.service', () => ({ SearchService: class {} }));

const id = (n: number) =>
  `019a1f00-0000-7000-8000-${String(n).padStart(12, '0')}`;
const opts = { userId: id(1), workspaceId: id(2) };

function setup() {
  const typesense = { search: jest.fn() };
  const database = { searchPage: jest.fn().mockResolvedValue({ items: [] }) };
  const service = new TypesenseSearchService(typesense as any, database as any);
  return { service, typesense, database };
}

describe('TypesenseSearchService', () => {
  it('paginates after checking permissions, continuing beyond restricted hits', async () => {
    const { service, typesense, database } = setup();
    typesense.search
      .mockResolvedValueOnce({
        found: 102,
        hits: Array.from({ length: 100 }, (_, n) => ({
          document: { id: id(n + 10) },
        })),
      })
      .mockResolvedValueOnce({
        found: 102,
        hits: [{ document: { id: id(110) } }, { document: { id: id(111) } }],
      });
    database.searchPage
      .mockResolvedValueOnce({ items: [{ id: id(10) }] })
      .mockResolvedValueOnce({ items: [{ id: id(110) }, { id: id(111) }] });

    const params = {
      query: 'colaboration',
      offset: 1,
      limit: 2,
      creatorId: id(3),
      labelIds: [id(4)],
      includeArchived: true,
    } as any;
    expect(await service.searchPage(params, opts)).toEqual({
      items: [{ id: id(110) }, { id: id(111) }],
    });
    expect(typesense.search).toHaveBeenNthCalledWith(
      2,
      'colaboration',
      opts.workspaceId,
      false,
      2,
    );
    expect(database.searchPage.mock.calls[0][0]).toMatchObject({
      ...params,
      offset: 0,
      limit: 100,
    });
    expect(database.searchPage.mock.calls[0][1]).toMatchObject({
      ...opts,
      candidatePageIds: expect.arrayContaining([id(10)]),
    });
  });

  it('passes live public page and share restrictions through to the database', async () => {
    const { service, typesense, database } = setup();
    typesense.search.mockResolvedValue({
      found: 1,
      hits: [{ document: { id: id(10) } }],
    });
    await service.searchPage({ query: '中文', shareId: 'share-key' } as any, {
      workspaceId: id(2),
      publicPageIds: [id(10)],
    });
    expect(database.searchPage).toHaveBeenCalledWith(
      expect.objectContaining({ shareId: 'share-key' }),
      {
        workspaceId: id(2),
        publicPageIds: [id(10)],
        candidatePageIds: [id(10)],
      },
    );
  });

  it('does not query Typesense when no public pages are allowed', async () => {
    const { service, typesense } = setup();
    expect(
      await service.searchPage({ query: 'secret' } as any, {
        workspaceId: id(2),
        publicPageIds: [],
      }),
    ).toEqual({ items: [] });
    expect(typesense.search).not.toHaveBeenCalled();
  });

  it('discards invalid IDs and duplicates from the index', async () => {
    const { service, typesense, database } = setup();
    typesense.search.mockResolvedValue({
      found: 3,
      hits: [
        { document: { id: 'invalid' } },
        { document: { id: id(10) } },
        { document: { id: id(10) } },
      ],
    });
    await service.searchPage({ query: 'roadmap' } as any, opts);
    expect(database.searchPage.mock.calls[0][1].candidatePageIds).toEqual([
      id(10),
    ]);
  });

  it('falls back to database search on engine failure without retaining candidates', async () => {
    const { service, typesense, database } = setup();
    typesense.search.mockRejectedValue(new Error('unavailable'));
    const params = { query: 'roadmap', offset: 4, limit: 5 } as any;
    database.searchPage.mockResolvedValue({ items: [{ id: id(10) }] });
    expect(await service.searchPage(params, opts)).toEqual({
      items: [{ id: id(10) }],
    });
    expect(database.searchPage).toHaveBeenCalledWith(params, opts);
  });

  it('uses database browsing when there is no text query', async () => {
    const { service, typesense, database } = setup();
    const params = { creatorId: id(3) } as any;
    await service.searchPage(params, opts);
    expect(typesense.search).not.toHaveBeenCalled();
    expect(database.searchPage).toHaveBeenCalledWith(params, opts);
  });
});
