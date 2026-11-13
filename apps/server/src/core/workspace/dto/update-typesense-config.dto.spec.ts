import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTypesenseConfigDto } from './update-typesense-config.dto';

const valid = { url: 'http://typesense:8108', apiKey: 'secret', locale: 'zh' };
const errors = (data: object) =>
  validateSync(plainToInstance(UpdateTypesenseConfigDto, data)).map(
    (error) => error.property,
  );

describe('Typesense settings input', () => {
  it('accepts internal service addresses and an omitted key', () => {
    expect(errors(valid)).toEqual([]);
    expect(errors({ url: valid.url, locale: 'en' })).toEqual([]);
  });
  it.each([
    'file:///etc/passwd',
    'ftp://search:8108',
    'search:8108',
    'http://user:password@search:8108',
  ])('rejects invalid URL %s', (url) => {
    expect(errors({ ...valid, url })).toContain('url');
  });
  it.each([null, '', '   ', 123])(
    'rejects an invalid replacement key %s',
    (apiKey) => {
      expect(errors({ ...valid, apiKey })).toContain('apiKey');
    },
  );
  it.each([null, '', 'zh-CN', 'invalid'])(
    'rejects an invalid language %s',
    (locale) => {
      expect(errors({ ...valid, locale })).toContain('locale');
    },
  );
  it('trims input and normalizes language codes', () => {
    const dto = plainToInstance(UpdateTypesenseConfigDto, {
      url: ' http://search:8108 ',
      locale: ' ZH ',
      apiKey: ' secret ',
    });
    expect(dto).toMatchObject({
      url: 'http://search:8108',
      locale: 'zh',
      apiKey: 'secret',
    });
    expect(validateSync(dto)).toEqual([]);
  });
});
