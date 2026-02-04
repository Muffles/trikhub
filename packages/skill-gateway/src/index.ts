// Gateway (local filesystem execution)
export {
  SkillGateway,
  type SkillGatewayConfig,
  type ExecuteSkillOptions,
  type GatewayResultWithSession,
  // Skill discovery types
  type ToolDefinition,
  type SkillInfo,
  type GetToolDefinitionsOptions,
} from './gateway.js';

// Session storage
export { type SessionStorage, InMemorySessionStorage } from './session-storage.js';

// Re-export types from skill-manifest for convenience
export type {
  SkillManifest,
  SkillManifestV2,
  ActionDefinition,
  ResponseMode,
  JSONSchema,
  ResponseTemplate,
  GatewayResult,
  GatewayResultV2,
  GatewaySuccess,
  GatewayError,
  GatewayClarification,
  GatewaySuccessV2,
  GatewaySuccessV2Template,
  GatewaySuccessV2Passthrough,
  ClarificationQuestion,
  ClarificationAnswer,
  // Session types
  SessionCapabilities,
  SessionHistoryEntry,
  SkillSession,
  SessionContext,
  // Passthrough types
  PassthroughContent,
  PassthroughDeliveryReceipt,
  UserContentReference,
} from '@saaas-poc/skill-manifest';

// Type guard
export { isManifestV2 } from '@saaas-poc/skill-manifest';
