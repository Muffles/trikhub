// Local gateway
export { LocalSkillGateway, type LocalGatewayConfig } from './gateway.js';

// Remote gateway
export { RemoteSkillGateway, type RemoteGatewayConfig } from './remote-gateway.js';

// Remote client (for advanced use)
export { RemoteSkillClient } from './remote-client.js';

// Re-export types from skill-manifest for convenience
export type {
  SkillManifest,
  GatewayResult,
  GatewaySuccess,
  GatewayError,
  GatewayClarification,
  ClarificationQuestion,
  ClarificationAnswer,
} from '@saaas-poc/skill-manifest';
