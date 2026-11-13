import { TypesenseClient } from './typesense.client';

// Run against a disposable Typesense instance, never a production collection:
// TYPESENSE_TEST_URL=http://127.0.0.1:18108 TYPESENSE_TEST_API_KEY=... pnpm --filter server test --runInBand typesense.integration
const describeIntegration = process.env.TYPESENSE_TEST_URL
  ? describe
  : describe.skip;

describeIntegration('Typesense live integration', () => {
  const workspaceId = '019a1f00-0000-7000-8000-000000000001';
  const spaceId = '019a1f00-0000-7000-8000-000000000002';
  const firstId = '019a1f00-0000-7000-8000-000000000010';
  const secondId = '019a1f00-0000-7000-8000-000000000011';
  const foreignId = '019a1f00-0000-7000-8000-000000000012';
  const mixedTitleId = '019a1f00-0000-7000-8000-000000000013';
  const mixedBodyId = '019a1f00-0000-7000-8000-000000000014';
  const pages = [
    {
      id: firstId,
      title: '中文测试文档',
      textContent: 'Collaboration handbook',
      workspaceId,
      spaceId,
      deletedAt: null,
    },
    {
      id: secondId,
      title: 'Handbook',
      textContent: '中文测试和 collaboration',
      workspaceId,
      spaceId,
      deletedAt: null,
    },
    {
      id: foreignId,
      title: '中文测试 我的帅哥123456',
      textContent: 'Collaboration',
      workspaceId: '019a1f00-0000-7000-8000-000000000099',
      spaceId,
      deletedAt: null,
    },
    {
      id: mixedTitleId,
      title: '我的帅哥123456',
      textContent: '',
      workspaceId,
      spaceId,
      deletedAt: null,
    },
    {
      id: mixedBodyId,
      title: 'Mixed content',
      textContent: '我的帅哥123456',
      workspaceId,
      spaceId,
      deletedAt: null,
    },
  ];
  const qb: any = {};
  for (const name of ['select', 'where']) qb[name] = () => qb;
  qb.execute = async () => pages;
  const service = new TypesenseClient(
    {
      url: process.env.TYPESENSE_TEST_URL,
      apiKey: process.env.TYPESENSE_TEST_API_KEY,
      locale: 'zh',
    } as any,
    { selectFrom: () => qb } as any,
    {} as any,
    workspaceId,
  );

  // Chinese boundaries must also work when the workspace uses English.
  const englishService = new TypesenseClient(
    {
      url: process.env.TYPESENSE_TEST_URL,
      apiKey: process.env.TYPESENSE_TEST_API_KEY,
      locale: 'en',
    },
    { selectFrom: () => qb } as any,
    {} as any,
    workspaceId,
  );

  afterAll(async () => {
    await englishService.request(
      `collections/${englishService.collectionName}`,
      { method: 'DELETE' },
    );
    await service.request(`collections/${service.collectionName}`, {
      method: 'DELETE',
    });
  });

  it('finds Chinese characters, words and adjacent numbers in either locale', async () => {
    for (const client of [service, englishService]) {
      await client.syncPages(pages.map((page) => page.id));
      for (const query of [
        '帅',
        '帅哥',
        '123456',
        '哥123456',
        '我的帅哥123456',
        '帅哥 123456',
      ]) {
        const result = await client.search(query, workspaceId, false, 1);
        expect(result.hits.map((hit) => hit.document.id).sort()).toEqual([
          mixedTitleId,
          mixedBodyId,
        ]);
        const titleOnly = await client.search(query, workspaceId, true, 1);
        expect(titleOnly.hits.map((hit) => hit.document.id)).toEqual([
          mixedTitleId,
        ]);
      }
      // A longer query must not degrade to a match for just one character or
      // silently turn a different number into the indexed identifier.
      for (const query of ['帅霸', '123457', '帅哥 987654']) {
        expect((await client.search(query, workspaceId, false, 1)).found).toBe(
          0,
        );
      }
    }
  }, 30000);

  it('indexes Chinese and English, tolerates typos, isolates workspaces, and synchronizes deletions/restores', async () => {
    await service.syncPages(pages.map((page) => page.id));
    const chinese = await service.search('中文', workspaceId, false, 1);
    expect(chinese.hits.map((hit) => hit.document.id).sort()).toEqual([
      firstId,
      secondId,
    ]);
    const titleOnly = await service.search('中文', workspaceId, true, 1);
    expect(titleOnly.hits.map((hit) => hit.document.id)).toEqual([firstId]);
    await englishService.syncPages(pages.map((page) => page.id));
    const typo = await englishService.search(
      'colaboration',
      workspaceId,
      false,
      1,
    );
    expect(typo.hits.map((hit) => hit.document.id).sort()).toEqual([
      firstId,
      secondId,
    ]);
    expect(
      typo.hits.every((hit) => Object.keys(hit.document).join() === 'id'),
    ).toBe(true);

    pages[0].deletedAt = new Date();
    await service.syncPages(pages.map((page) => page.id));
    expect((await service.search('中文', workspaceId, true, 1)).found).toBe(0);
    pages[0].deletedAt = null;
    pages[0].title = '恢复后的中文标题';
    await service.syncPages(pages.map((page) => page.id));
    expect(
      (await service.search('恢复', workspaceId, true, 1)).hits.map(
        (hit) => hit.document.id,
      ),
    ).toEqual([firstId]);
    await service.removeByFilter(`workspaceId:=${workspaceId}`);
    expect((await service.search('中文', workspaceId, false, 1)).found).toBe(0);
  }, 30000);
});
