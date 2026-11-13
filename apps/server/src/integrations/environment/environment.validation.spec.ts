import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { EnvironmentVariables } from './environment.validation';

function errors(config: Record<string, unknown>) {
  return validateSync(plainToInstance(EnvironmentVariables, config))
    .filter((error) => error.property.startsWith('TYPESENSE_'))
    .map((error) => error.property);
}

describe('Typesense environment validation', () => {
  it.each([
    {},
    { TYPESENSE_URL: '', TYPESENSE_API_KEY: '' },
    { TYPESENSE_URL: ' ', TYPESENSE_API_KEY: ' ' },
  ])('allows an unconfigured optional connection (%j)', (config) => {
    expect(errors(config)).toEqual([]);
  });
  it.each([
    'http://typesense:8108',
    'https://search.example.com',
    ' http://typesense:8108 ',
  ])('accepts a complete connection (%s)', (url) => {
    expect(errors({ TYPESENSE_URL: url, TYPESENSE_API_KEY: 'key' })).toEqual(
      [],
    );
  });
  it('requires a key when the URL is set', () => {
    expect(
      errors({
        TYPESENSE_URL: 'http://typesense:8108',
        TYPESENSE_API_KEY: ' ',
      }),
    ).toContain('TYPESENSE_API_KEY');
  });
  it('requires a URL when the key is set', () => {
    expect(errors({ TYPESENSE_API_KEY: 'key' })).toContain('TYPESENSE_URL');
  });
  it.each([
    'file:///etc/passwd',
    'ftp://search:8108',
    'search:8108',
    'http://user:password@search:8108',
  ])('rejects an invalid address (%s)', (url) => {
    expect(errors({ TYPESENSE_URL: url, TYPESENSE_API_KEY: 'key' })).toContain(
      'TYPESENSE_URL',
    );
  });
});
