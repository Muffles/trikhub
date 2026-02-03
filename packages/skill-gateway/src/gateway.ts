import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type SkillManifest,
  type GatewayResult,
  type ClarificationQuestion,
  validateManifest,
  SchemaValidator,
} from '@saaas-poc/skill-manifest';

/**
 * Configuration for LocalSkillGateway
 */
export interface LocalGatewayConfig {
  /** Callback when a skill needs clarification */
  onClarificationNeeded?: (
    skillId: string,
    questions: ClarificationQuestion[]
  ) => Promise<Record<string, string | boolean>>;
}

/**
 * Result from a LangGraph invocation
 */
interface GraphResult {
  output?: unknown;
  needsClarification?: boolean;
  clarificationQuestion?: ClarificationQuestion;
  clarificationQuestions?: ClarificationQuestion[];
}

/**
 * Compiled LangGraph interface
 */
interface CompiledGraph {
  invoke(input: unknown): Promise<GraphResult>;
}

/**
 * Gateway for executing local skills (LangGraph projects)
 */
export class LocalSkillGateway {
  private manifests = new Map<string, SkillManifest>();
  private graphs = new Map<string, CompiledGraph>();
  private skillPaths = new Map<string, string>();
  private validator = new SchemaValidator();
  private config: LocalGatewayConfig;

  constructor(config: LocalGatewayConfig = {}) {
    this.config = config;
  }

  /**
   * Load a skill from disk
   */
  async loadSkill(skillPath: string): Promise<SkillManifest> {
    // 1. Load and validate manifest
    const manifestPath = join(skillPath, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);

    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors?.join(', ')}`);
    }

    const manifest = manifestData as SkillManifest;

    // 2. Dynamically import the compiled graph
    const modulePath = join(skillPath, manifest.entry.module);
    const moduleUrl = pathToFileURL(modulePath).href;
    const module = await import(moduleUrl);
    const graph = module[manifest.entry.export] as CompiledGraph;

    if (!graph || typeof graph.invoke !== 'function') {
      throw new Error(
        `Invalid graph: module "${manifest.entry.module}" export "${manifest.entry.export}" is not a compiled LangGraph`
      );
    }

    // 3. Cache everything
    this.manifests.set(manifest.id, manifest);
    this.graphs.set(manifest.id, graph);
    this.skillPaths.set(manifest.id, skillPath);

    return manifest;
  }

  /**
   * Get a loaded skill's manifest
   */
  getManifest(skillId: string): SkillManifest | undefined {
    return this.manifests.get(skillId);
  }

  /**
   * Check if a skill is loaded
   */
  isLoaded(skillId: string): boolean {
    return this.manifests.has(skillId);
  }

  /**
   * Execute a skill
   */
  async executeSkill<TOutput>(
    skillId: string,
    input: unknown
  ): Promise<GatewayResult<TOutput>> {
    const manifest = this.manifests.get(skillId);
    const graph = this.graphs.get(skillId);

    if (!manifest || !graph) {
      return {
        success: false,
        code: 'SKILL_NOT_FOUND',
        error: `Skill "${skillId}" not found. Did you forget to call loadSkill()?`,
      };
    }

    // 1. Validate input
    const inputValidation = this.validator.validate(
      `${skillId}:input`,
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

    // 2. Execute with timeout
    try {
      const result = await this.executeWithTimeout(
        graph,
        { input },
        manifest.limits.maxExecutionTimeMs
      );

      // 3. Handle clarification
      if (result.needsClarification) {
        const questions = result.clarificationQuestions ||
          (result.clarificationQuestion ? [result.clarificationQuestion] : []);

        if (questions.length > 0) {
          // If we have a clarification handler, use it
          if (this.config.onClarificationNeeded) {
            const answers = await this.config.onClarificationNeeded(skillId, questions);

            // Re-invoke with answers
            const clarifiedResult = await this.executeWithTimeout(
              graph,
              { input, clarificationAnswers: answers },
              manifest.limits.maxExecutionTimeMs
            );

            if (clarifiedResult.output !== undefined) {
              return this.validateAndReturnOutput<TOutput>(
                skillId,
                manifest,
                clarifiedResult.output
              );
            }
          }

          // Return clarification needed
          return {
            success: false,
            code: 'CLARIFICATION_NEEDED',
            sessionId: `${skillId}-${Date.now()}`,
            questions,
          };
        }
      }

      // 4. Validate and return output
      if (result.output !== undefined) {
        return this.validateAndReturnOutput<TOutput>(skillId, manifest, result.output);
      }

      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: 'Skill did not return an output',
      };
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMEOUT') {
        return {
          success: false,
          code: 'TIMEOUT',
          error: `Skill execution exceeded ${manifest.limits.maxExecutionTimeMs}ms timeout`,
        };
      }

      return {
        success: false,
        code: 'EXECUTION_ERROR',
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  /**
   * Execute graph with timeout
   */
  private async executeWithTimeout(
    graph: CompiledGraph,
    input: unknown,
    timeoutMs: number
  ): Promise<GraphResult> {
    return Promise.race([
      graph.invoke(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      ),
    ]);
  }

  /**
   * Validate output and return success result
   */
  private validateAndReturnOutput<TOutput>(
    skillId: string,
    manifest: SkillManifest,
    output: unknown
  ): GatewayResult<TOutput> {
    const outputValidation = this.validator.validate(
      `${skillId}:output`,
      manifest.outputSchema,
      output
    );

    if (!outputValidation.valid) {
      return {
        success: false,
        code: 'INVALID_OUTPUT',
        error: `Invalid output from skill: ${outputValidation.errors?.join(', ')}`,
      };
    }

    return {
      success: true,
      data: output as TOutput,
    };
  }

  /**
   * Unload a skill
   */
  unloadSkill(skillId: string): void {
    this.manifests.delete(skillId);
    this.graphs.delete(skillId);
    this.skillPaths.delete(skillId);
  }

  /**
   * Get all loaded skill IDs
   */
  getLoadedSkills(): string[] {
    return Array.from(this.manifests.keys());
  }
}
