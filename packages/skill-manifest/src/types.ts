/**
 * JSON Schema type (subset for our needs)
 */
export interface JSONSchema {
  type?: string | string[];
  properties?: Record<string, JSONSchema>;
  items?: JSONSchema;
  required?: string[];
  enum?: unknown[];
  const?: unknown;
  $ref?: string;
  $defs?: Record<string, JSONSchema>;
  additionalProperties?: boolean | JSONSchema;
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
  description?: string;
  default?: unknown;
  [key: string]: unknown;
}

/**
 * Skill capabilities declared in manifest
 */
export interface SkillCapabilities {
  /** List of tool names this skill uses */
  tools: string[];
  /** Whether skill can request clarification from user */
  canRequestClarification: boolean;
}

/**
 * Resource limits for skill execution
 */
export interface SkillLimits {
  /** Maximum execution time in milliseconds */
  maxExecutionTimeMs: number;
  /** Maximum number of LLM calls allowed */
  maxLlmCalls: number;
  /** Maximum number of tool calls allowed */
  maxToolCalls: number;
}

/**
 * Entry point configuration
 */
export interface SkillEntry {
  /** Path to the compiled module (relative to skill directory) */
  module: string;
  /** Export name to use (usually "default") */
  export: string;
}

/**
 * The skill manifest - the single source of truth for the skill contract
 */
export interface SkillManifest {
  /** Unique identifier for the skill */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what the skill does */
  description: string;
  /** Semantic version */
  version: string;

  /** JSON Schema for input validation */
  inputSchema: JSONSchema;
  /** JSON Schema for output validation */
  outputSchema: JSONSchema;

  /** Declared capabilities */
  capabilities: SkillCapabilities;
  /** Resource limits */
  limits: SkillLimits;
  /** Entry point */
  entry: SkillEntry;

  /** Optional: author name */
  author?: string;
  /** Optional: repository URL */
  repository?: string;
  /** Optional: license identifier */
  license?: string;
}

// ============================================
// Wire Protocol Types (for remote skills)
// ============================================

/**
 * Request to execute a skill
 */
export interface ExecuteRequest {
  requestId: string;
  input: unknown;
}

/**
 * Clarification question from a skill
 */
export interface ClarificationQuestion {
  questionId: string;
  questionText: string;
  questionType: 'text' | 'multiple_choice' | 'boolean';
  options?: string[];
  required?: boolean;
}

/**
 * Answer to a clarification question
 */
export interface ClarificationAnswer {
  questionId: string;
  answer: string | boolean;
}

/**
 * Request to provide clarification answers
 */
export interface ClarifyRequest {
  sessionId: string;
  answers: ClarificationAnswer[];
}

/**
 * Successful execution response
 */
export interface SuccessResponse {
  requestId: string;
  type: 'result';
  data: unknown;
}

/**
 * Clarification needed response
 */
export interface ClarificationResponse {
  requestId: string;
  type: 'clarification_needed';
  sessionId: string;
  questions: ClarificationQuestion[];
}

/**
 * Error response
 */
export interface ErrorResponse {
  requestId: string;
  type: 'error';
  code: string;
  message: string;
}

/**
 * Union of all possible execution responses
 */
export type ExecuteResponse = SuccessResponse | ClarificationResponse | ErrorResponse;

// ============================================
// Gateway Result Types
// ============================================

export type GatewayErrorCode =
  | 'SKILL_NOT_FOUND'
  | 'INVALID_INPUT'
  | 'INVALID_OUTPUT'
  | 'TIMEOUT'
  | 'EXECUTION_ERROR'
  | 'NOT_ALLOWED'
  | 'NETWORK_ERROR';

export interface GatewaySuccess<T> {
  success: true;
  data: T;
}

export interface GatewayError {
  success: false;
  code: GatewayErrorCode;
  error: string;
  details?: unknown;
}

export interface GatewayClarification {
  success: false;
  code: 'CLARIFICATION_NEEDED';
  sessionId: string;
  questions: ClarificationQuestion[];
}

export type GatewayResult<T> = GatewaySuccess<T> | GatewayError | GatewayClarification;
