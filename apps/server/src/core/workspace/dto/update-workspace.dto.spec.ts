import { validateSync } from 'class-validator';
import { UpdateWorkspaceDto } from './update-workspace.dto';

describe('UpdateWorkspaceDto search driver', () => {
  it.each(['database', 'typesense', undefined])(
    'accepts %s',
    (searchDriver) => {
      const dto = Object.assign(new UpdateWorkspaceDto(), { searchDriver });
      expect(validateSync(dto)).toEqual([]);
    },
  );

  it.each([null, '', 'invalid', true])('rejects %s', (searchDriver) => {
    const dto = Object.assign(new UpdateWorkspaceDto(), { searchDriver });
    expect(validateSync(dto).map((error) => error.property)).toContain(
      'searchDriver',
    );
  });
});
