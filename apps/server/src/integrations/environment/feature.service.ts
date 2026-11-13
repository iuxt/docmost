import { Injectable } from '@nestjs/common';
import { Feature, FeatureKey } from '../../common/features';

// Only advertise features implemented by the modules shipped with this server.
// Optional modules without a server implementation must remain unavailable.
const AVAILABLE_FEATURES: readonly FeatureKey[] = [
  Feature.SECURITY_SETTINGS,
  Feature.RETENTION,
  Feature.SHARING_CONTROLS,
  Feature.VIEWER_COMMENTS,
  Feature.PUBLIC_SPACE_APPEARANCE,
];

@Injectable()
export class FeatureService {
  hasFeature(feature: string): boolean {
    return AVAILABLE_FEATURES.some((available) => available === feature);
  }

  getFeatures(): string[] {
    return [...AVAILABLE_FEATURES];
  }
}
