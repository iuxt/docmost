import { WorkspaceController } from './workspace.controller';
import WorkspaceAbilityFactory from '../../casl/abilities/workspace-ability.factory';
import { UserRole } from '../../../common/helpers/types/permission';

function setup() {
  const config = {
    getSettings: jest.fn(),
    save: jest.fn(),
    testConnection: jest.fn(),
  };
  const controller = new WorkspaceController(
    {} as any,
    {} as any,
    new WorkspaceAbilityFactory(),
    {} as any,
    {} as any,
    config as any,
  );
  return { controller, config };
}
const workspace = { id: 'server-workspace' } as any;
const dto = { url: 'http://search:8108', locale: 'zh', apiKey: 'secret' };

describe('Workspace search configuration authorization', () => {
  it.each([UserRole.MEMBER])(
    'denies non-administrators on all configuration endpoints',
    async (role) => {
      const { controller, config } = setup();
      const user = { role } as any;
      await expect(
        controller.getSearchSettings(user, workspace),
      ).rejects.toThrow('Forbidden');
      await expect(
        controller.updateSearchSettings(user, workspace, dto),
      ).rejects.toThrow('Forbidden');
      await expect(
        controller.testSearchSettings(user, workspace, dto),
      ).rejects.toThrow('Forbidden');
      expect(config.getSettings).not.toHaveBeenCalled();
      expect(config.save).not.toHaveBeenCalled();
      expect(config.testConnection).not.toHaveBeenCalled();
    },
  );
  it.each([UserRole.OWNER, UserRole.ADMIN])(
    'allows %s and uses the authenticated workspace',
    async (role) => {
      const { controller, config } = setup();
      const user = { role } as any;
      await controller.getSearchSettings(user, workspace);
      await controller.updateSearchSettings(user, workspace, dto);
      await controller.testSearchSettings(user, workspace, dto);
      expect(config.getSettings).toHaveBeenCalledWith(workspace.id);
      expect(config.save).toHaveBeenCalledWith(workspace.id, dto);
      expect(config.testConnection).toHaveBeenCalledWith(workspace.id, dto);
    },
  );
});
