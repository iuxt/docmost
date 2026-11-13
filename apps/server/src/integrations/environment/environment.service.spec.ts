import { ConfigService } from '@nestjs/config';
import { EnvironmentService } from './environment.service';

function setup(config: Record<string, string> = {}) {
  return new EnvironmentService(new ConfigService(config));
}

describe('EnvironmentService search configuration', () => {
  it('defaults to database search', () => {
    expect(setup().getSearchDriver()).toBe('database');
  });

  it.each(['database', 'typesense'])(
    'ignores the legacy server default %s for workspaces without a setting',
    (driver) => {
      const service = setup({ SEARCH_DRIVER: driver });
      expect(service.getSearchDriver()).toBe('database');
      expect(service.getSearchDriver({ settings: null })).toBe('database');
      expect(service.getSearchDriver({ settings: {} })).toBe('database');
    },
  );

  it.each(['database', 'typesense'])(
    'uses the workspace setting %s without affecting other workspaces',
    (driver) => {
      const service = setup({ SEARCH_DRIVER: 'typesense' });
      expect(
        service.getSearchDriver({ settings: { searchDriver: driver } }),
      ).toBe(driver);
      expect(service.getSearchDriver({ settings: {} })).toBe('database');
    },
  );

  it('ignores invalid persisted settings', () => {
    expect(
      setup({ SEARCH_DRIVER: 'typesense' }).getSearchDriver({
        settings: { searchDriver: 'invalid' },
      }),
    ).toBe('database');
  });
});

describe('EnvironmentService Typesense connection', () => {
  it('normalizes the URL and key', () => {
    const service = setup({
      TYPESENSE_URL: ' http://typesense:8108/// ',
      TYPESENSE_API_KEY: ' key ',
    });
    expect(service.getTypesenseUrl()).toBe('http://typesense:8108');
    expect(service.getTypesenseApiKey()).toBe('key');
    expect(service.isTypesenseConfigured()).toBe(true);
  });
  it.each([
    {},
    { TYPESENSE_URL: 'http://typesense:8108' },
    { TYPESENSE_API_KEY: 'key' },
    { TYPESENSE_URL: 'http://typesense:8108', TYPESENSE_API_KEY: '   ' },
  ])('requires both connection values (%j)', (env) => {
    expect(setup(env).isTypesenseConfigured()).toBe(false);
  });
});
