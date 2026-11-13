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
    'uses the server default %s for workspaces without a setting',
    (driver) => {
      const service = setup({ SEARCH_DRIVER: driver });
      expect(service.getSearchDriver()).toBe(driver);
      expect(service.getSearchDriver({ settings: null })).toBe(driver);
      expect(service.getSearchDriver({ settings: {} })).toBe(driver);
    },
  );

  it.each([
    ['database', 'typesense'],
    ['typesense', 'database'],
  ])(
    'lets workspace %s override server %s without affecting other workspaces',
    (driver, server) => {
      const service = setup({ SEARCH_DRIVER: server });
      expect(
        service.getSearchDriver({ settings: { searchDriver: driver } }),
      ).toBe(driver);
      expect(service.getSearchDriver({ settings: {} })).toBe(server);
    },
  );

  it('ignores invalid persisted settings', () => {
    expect(
      setup().getSearchDriver({ settings: { searchDriver: 'invalid' } }),
    ).toBe('database');
  });

  it('allows workspace Typesense search when the global default is database', () => {
    const service = setup({
      SEARCH_DRIVER: 'database',
      TYPESENSE_API_KEY: 'test-key',
    });
    expect(service.isTypesenseConfigured()).toBe(true);
    expect(service.getSearchDriver()).toBe('database');
  });

  it.each([undefined, '', '   '])(
    'does not enable Typesense without a usable key (%s)',
    (key) => {
      const service = setup(
        key === undefined ? {} : { TYPESENSE_API_KEY: key },
      );
      expect(service.isTypesenseConfigured()).toBe(false);
    },
  );
});
