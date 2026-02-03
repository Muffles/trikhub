import {
  type SkillManifest,
  type GatewayResult,
  type ClarificationQuestion,
  type ClarificationAnswer,
  validateManifest,
  SchemaValidator,
} from '@saaas-poc/skill-manifest';
import { RemoteSkillClient } from './remote-client.js';

/**
 * Configuration for RemoteSkillGateway
 */
export interface RemoteGatewayConfig {
  /** List of allowed skill IDs */
  allowedSkills: string[];
  /** Callback when a skill needs clarification */
  onClarificationNeeded?: (
    skillId: string,
    questions: ClarificationQuestion[]
  ) => Promise<ClarificationAnswer[]>;
}

/**
 * Gateway for executing remote skills over HTTP
 */
export class RemoteSkillGateway {
  private client = new RemoteSkillClient();
  private validator = new SchemaValidator();
  private config: RemoteGatewayConfig;

  constructor(config: RemoteGatewayConfig) {
    this.config = config;
  }

  /**
   * Check if a skill is allowed by the allowlist
   */
  isAllowed(skillId: string): boolean {
    return this.config.allowedSkills.includes(skillId);
  }

  /**
   * Fetch and validate a skill manifest
   */
  async getManifest(endpoint: string): Promise<SkillManifest> {
    const manifest = await this.client.fetchManifest(endpoint);

    const validation = validateManifest(manifest);
    if (!validation.valid) {
      throw new Error(`Invalid manifest from ${endpoint}: ${validation.errors?.join(', ')}`);
    }

    return manifest;
  }

  /**
   * Execute a remote skill
   */
  async executeRemoteSkill<TOutput>(
    endpoint: string,
    input: unknown
  ): Promise<GatewayResult<TOutput>> {
    // 1. Fetch manifest
    let manifest: SkillManifest;
    try {
      manifest = await this.getManifest(endpoint);
    } catch (error) {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        error: `Failed to fetch manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // 2. Check allowlist
    if (!this.isAllowed(manifest.id)) {
      return {
        success: false,
        code: 'NOT_ALLOWED',
        error: `Skill "${manifest.id}" is not in the allowlist`,
      };
    }

    // 3. Validate input locally
    const inputValidation = this.validator.validate(
      `${manifest.id}:input`,
      manifest.inputSchema,
      input
    );
    if (!inputValidation.valid) {
      return {
        success: false,
        code: 'INVALID_INPUT',
        error: `Invalid input: ${inputValidation.errors?.join(', ')}`,
      };
    }

    // 4. Execute on remote
    const response = await this.client.execute(
      endpoint,
      input,
      manifest.limits.maxExecutionTimeMs
    );

    // 5. Handle response
    if (response.type === 'error') {
      if (response.code === 'TIMEOUT') {
        return {
          success: false,
          code: 'TIMEOUT',
          error: response.message,
        };
      }
      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: response.message,
      };
    }

    if (response.type === 'clarification_needed') {
      // If we have a clarification handler, use it
      if (this.config.onClarificationNeeded) {
        const answers = await this.config.onClarificationNeeded(
          manifest.id,
          response.questions
        );

        // Send clarification answers
        const clarifyResponse = await this.client.clarify(
          endpoint,
          response.sessionId,
          answers,
          manifest.limits.maxExecutionTimeMs
        );

        if (clarifyResponse.type === 'result') {
          return this.validateAndReturnOutput<TOutput>(manifest, clarifyResponse.data);
        }

        if (clarifyResponse.type === 'error') {
          return {
            success: false,
            code: 'EXECUTION_ERROR',
            error: clarifyResponse.message,
          };
        }
      }

      // Return clarification needed to caller
      return {
        success: false,
        code: 'CLARIFICATION_NEEDED',
        sessionId: response.sessionId,
        questions: response.questions,
      };
    }

    // 6. Validate output
    return this.validateAndReturnOutput<TOutput>(manifest, response.data);
  }

  /**
   * Continue execution with clarification answers
   */
  async continueWithClarification<TOutput>(
    endpoint: string,
    sessionId: string,
    answers: ClarificationAnswer[]
  ): Promise<GatewayResult<TOutput>> {
    // Fetch manifest to validate output
    let manifest: SkillManifest;
    try {
      manifest = await this.getManifest(endpoint);
    } catch (error) {
      return {
        success: false,
        code: 'NETWORK_ERROR',
        error: `Failed to fetch manifest: ${error instanceof Error ? error.message : 'Unknown error'}`,
      };
    }

    // Send clarification
    const response = await this.client.clarify(
      endpoint,
      sessionId,
      answers,
      manifest.limits.maxExecutionTimeMs
    );

    if (response.type === 'error') {
      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: response.message,
      };
    }

    if (response.type === 'clarification_needed') {
      return {
        success: false,
        code: 'CLARIFICATION_NEEDED',
        sessionId: response.sessionId,
        questions: response.questions,
      };
    }

    return this.validateAndReturnOutput<TOutput>(manifest, response.data);
  }

  /**
   * Validate output and return success result
   */
  private validateAndReturnOutput<TOutput>(
    manifest: SkillManifest,
    output: unknown
  ): GatewayResult<TOutput> {
    const outputValidation = this.validator.validate(
      `${manifest.id}:output`,
      manifest.outputSchema,
      output
    );

    if (!outputValidation.valid) {
      return {
        success: false,
        code: 'INVALID_OUTPUT',
        error: `Invalid output from remote skill: ${outputValidation.errors?.join(', ')}`,
      };
    }

    return {
      success: true,
      data: output as TOutput,
    };
  }

  /**
   * Check if a remote skill host is healthy
   */
  async healthCheck(endpoint: string): Promise<boolean> {
    return this.client.healthCheck(endpoint);
  }

  /**
   * Update the allowlist
   */
  setAllowedSkills(skillIds: string[]): void {
    this.config.allowedSkills = skillIds;
  }

  /**
   * Add a skill to the allowlist
   */
  allowSkill(skillId: string): void {
    if (!this.config.allowedSkills.includes(skillId)) {
      this.config.allowedSkills.push(skillId);
    }
  }

  /**
   * Remove a skill from the allowlist
   */
  disallowSkill(skillId: string): void {
    this.config.allowedSkills = this.config.allowedSkills.filter((id) => id !== skillId);
  }
}
