import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { UpdateTypesenseConfigDto } from './update-typesense-config.dto';

const errors = (data: object) =>
  validateSync(plainToInstance(UpdateTypesenseConfigDto, data));

describe('Typesense workspace language input', () => {
  it.each(['zh', 'en'])(
    'accepts language %s without connection credentials',
    (locale) => {
      expect(errors({ locale })).toEqual([]);
    },
  );
  it.each([undefined, null, '', 'zh-CN', 'invalid', 123])(
    'rejects invalid language %s',
    (locale) => {
      expect(errors({ locale }).map((error) => error.property)).toContain(
        'locale',
      );
    },
  );
  it('trims and normalizes the language', () => {
    const dto = plainToInstance(UpdateTypesenseConfigDto, { locale: ' ZH ' });
    expect(dto.locale).toBe('zh');
    expect(validateSync(dto)).toEqual([]);
  });
  it('strips client-supplied connection credentials using the application whitelist', () => {
    const dto = plainToInstance(UpdateTypesenseConfigDto, {
      locale: 'en',
      url: 'http://client:8108',
      apiKey: 'client-secret',
    });
    expect(validateSync(dto, { whitelist: true })).toEqual([]);
    expect(dto).toEqual({ locale: 'en' });
  });
});
