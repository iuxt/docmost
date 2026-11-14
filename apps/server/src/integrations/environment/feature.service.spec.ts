import { FeatureService } from './feature.service';
import { Feature } from '../../common/features';
import { WorkspaceController } from '../../core/workspace/controllers/workspace.controller';

describe('Server capabilities', () => {
  const service = new FeatureService();

  it('makes built-in sharing and security settings available without workspace credentials', () => {
    expect(service.hasFeature(Feature.SECURITY_SETTINGS)).toBe(true);
    expect(service.hasFeature(Feature.SHARING_CONTROLS)).toBe(true);
    expect(service.hasFeature(Feature.VIEWER_COMMENTS)).toBe(true);
    expect(service.hasFeature(Feature.RETENTION)).toBe(true);
    expect(service.hasFeature(Feature.PUBLIC_SPACE_APPEARANCE)).toBe(true);
  });

  it('keeps optional features without a server implementation unavailable', () => {
    for (const feature of [
      Feature.AI,
      Feature.SSO_CUSTOM,
      Feature.MFA,
      Feature.BASES,
      Feature.ANNOUNCEMENTS,
      Feature.DOCX_IMPORT,
    ]) {
      expect(service.hasFeature(feature)).toBe(false);
    }
    expect(service.hasFeature('unknown-feature')).toBe(false);
  });

  it('only exposes server capabilities through the workspace endpoint', () => {
    const controller = new WorkspaceController(
      undefined,
      undefined,
      undefined,
      undefined,
      service,
      undefined,
    );
    expect(controller.getCapabilities()).toEqual({
      features: service.getFeatures(),
    });
  });

  it('does not let callers mutate the capabilities of later requests', () => {
    service.getFeatures().splice(0);
    expect(service.hasFeature(Feature.SECURITY_SETTINGS)).toBe(true);
    expect(service.getFeatures()).toContain(Feature.SECURITY_SETTINGS);
  });
});
