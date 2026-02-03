import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  type SkillManifest,
  type ExecuteRequest,
  type ExecuteResponse,
  type ClarifyRequest,
  type ClarificationAnswer,
  validateManifest,
  SchemaValidator,
} from '@saaas-poc/skill-manifest';

/**
 * Result from a LangGraph invocation
 */
interface GraphResult {
  output?: unknown;
  needsClarification?: boolean;
  clarificationQuestion?: unknown;
  clarificationQuestions?: unknown[];
}

/**
 * Compiled LangGraph interface
 */
interface CompiledGraph {
  invoke(input: unknown): Promise<GraphResult>;
}

/**
 * Session data for clarification flow
 */
interface Session {
  requestId: string;
  input: unknown;
  createdAt: number;
}

/**
 * Configuration for SkillHost
 */
export interface SkillHostConfig {
  /** Path to the skill directory */
  skillPath: string;
  /** Port to listen on */
  port?: number;
  /** Host to bind to */
  host?: string;
}

/**
 * HTTP server that hosts a skill for remote access
 */
export class SkillHost {
  private server: Server | null = null;
  private manifest: SkillManifest | null = null;
  private graph: CompiledGraph | null = null;
  private validator = new SchemaValidator();
  private sessions = new Map<string, Session>();
  private sessionTtlMs = 10 * 60 * 1000; // 10 minutes
  private config: Required<SkillHostConfig>;

  constructor(config: SkillHostConfig) {
    this.config = {
      skillPath: config.skillPath,
      port: config.port ?? 3000,
      host: config.host ?? '0.0.0.0',
    };
  }

  /**
   * Load the skill from disk
   */
  async load(): Promise<SkillManifest> {
    // Load manifest
    const manifestPath = join(this.config.skillPath, 'manifest.json');
    const manifestContent = await readFile(manifestPath, 'utf-8');
    const manifestData = JSON.parse(manifestContent);

    const validation = validateManifest(manifestData);
    if (!validation.valid) {
      throw new Error(`Invalid manifest: ${validation.errors?.join(', ')}`);
    }

    this.manifest = manifestData as SkillManifest;

    // Load graph
    const modulePath = join(this.config.skillPath, this.manifest.entry.module);
    const moduleUrl = pathToFileURL(modulePath).href;
    const module = await import(moduleUrl);
    this.graph = module[this.manifest.entry.export] as CompiledGraph;

    if (!this.graph || typeof this.graph.invoke !== 'function') {
      throw new Error('Invalid graph: export is not a compiled LangGraph');
    }

    return this.manifest;
  }

  /**
   * Start the HTTP server
   */
  async start(): Promise<void> {
    if (!this.manifest || !this.graph) {
      await this.load();
    }

    this.server = createServer((req, res) => this.handleRequest(req, res));

    return new Promise((resolve) => {
      this.server!.listen(this.config.port, this.config.host, () => {
        console.log(`Skill host running at http://${this.config.host}:${this.config.port}`);
        console.log(`Hosting skill: ${this.manifest!.name} (${this.manifest!.id})`);
        resolve();
      });
    });
  }

  /**
   * Stop the HTTP server
   */
  async stop(): Promise<void> {
    if (this.server) {
      return new Promise((resolve) => {
        this.server!.close(() => resolve());
        this.server = null;
      });
    }
  }

  /**
   * Get the loaded manifest
   */
  getManifest(): SkillManifest | null {
    return this.manifest;
  }

  /**
   * Handle incoming HTTP requests
   */
  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Accept');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    try {
      if (req.method === 'GET' && url.pathname === '/manifest') {
        this.handleGetManifest(res);
      } else if (req.method === 'GET' && url.pathname === '/health') {
        this.handleHealthCheck(res);
      } else if (req.method === 'POST' && url.pathname === '/execute') {
        await this.handleExecute(req, res);
      } else if (req.method === 'POST' && url.pathname === '/clarify') {
        await this.handleClarify(req, res);
      } else {
        this.sendError(res, 404, 'NOT_FOUND', 'Endpoint not found');
      }
    } catch (error) {
      console.error('Request error:', error);
      this.sendError(res, 500, 'INTERNAL_ERROR', 'Internal server error');
    }
  }

  /**
   * Handle GET /manifest
   */
  private handleGetManifest(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(this.manifest));
  }

  /**
   * Handle GET /health
   */
  private handleHealthCheck(res: ServerResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', skillId: this.manifest?.id }));
  }

  /**
   * Handle POST /execute
   */
  private async handleExecute(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const request = JSON.parse(body) as ExecuteRequest;

    // Validate input
    const inputValidation = this.validator.validate(
      `${this.manifest!.id}:input`,
      this.manifest!.inputSchema,
      request.input
    );

    if (!inputValidation.valid) {
      this.sendResponse(res, {
        requestId: request.requestId,
        type: 'error',
        code: 'INVALID_INPUT',
        message: `Invalid input: ${inputValidation.errors?.join(', ')}`,
      });
      return;
    }

    // Execute graph
    try {
      const result = await this.executeWithTimeout(
        { input: request.input },
        this.manifest!.limits.maxExecutionTimeMs
      );

      // Handle clarification
      if (result.needsClarification) {
        const questions = result.clarificationQuestions ||
          (result.clarificationQuestion ? [result.clarificationQuestion] : []);

        if (questions.length > 0) {
          const sessionId = crypto.randomUUID();
          this.sessions.set(sessionId, {
            requestId: request.requestId,
            input: request.input,
            createdAt: Date.now(),
          });
          this.cleanupSessions();

          this.sendResponse(res, {
            requestId: request.requestId,
            type: 'clarification_needed',
            sessionId,
            questions: questions as any[],
          });
          return;
        }
      }

      // Validate output
      if (result.output !== undefined) {
        const outputValidation = this.validator.validate(
          `${this.manifest!.id}:output`,
          this.manifest!.outputSchema,
          result.output
        );

        if (!outputValidation.valid) {
          this.sendResponse(res, {
            requestId: request.requestId,
            type: 'error',
            code: 'INVALID_OUTPUT',
            message: `Invalid output: ${outputValidation.errors?.join(', ')}`,
          });
          return;
        }

        this.sendResponse(res, {
          requestId: request.requestId,
          type: 'result',
          data: result.output,
        });
        return;
      }

      this.sendResponse(res, {
        requestId: request.requestId,
        type: 'error',
        code: 'NO_OUTPUT',
        message: 'Skill did not produce output',
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'TIMEOUT') {
        this.sendResponse(res, {
          requestId: request.requestId,
          type: 'error',
          code: 'TIMEOUT',
          message: `Execution timed out after ${this.manifest!.limits.maxExecutionTimeMs}ms`,
        });
        return;
      }

      this.sendResponse(res, {
        requestId: request.requestId,
        type: 'error',
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Handle POST /clarify
   */
  private async handleClarify(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await this.readBody(req);
    const request = JSON.parse(body) as ClarifyRequest;

    const session = this.sessions.get(request.sessionId);
    if (!session) {
      this.sendResponse(res, {
        requestId: request.sessionId,
        type: 'error',
        code: 'SESSION_NOT_FOUND',
        message: 'Clarification session not found or expired',
      });
      return;
    }

    // Remove session
    this.sessions.delete(request.sessionId);

    // Re-execute with clarification answers
    try {
      const answersMap = this.answersToMap(request.answers);
      const result = await this.executeWithTimeout(
        { input: session.input, clarificationAnswers: answersMap },
        this.manifest!.limits.maxExecutionTimeMs
      );

      if (result.output !== undefined) {
        const outputValidation = this.validator.validate(
          `${this.manifest!.id}:output`,
          this.manifest!.outputSchema,
          result.output
        );

        if (!outputValidation.valid) {
          this.sendResponse(res, {
            requestId: session.requestId,
            type: 'error',
            code: 'INVALID_OUTPUT',
            message: `Invalid output: ${outputValidation.errors?.join(', ')}`,
          });
          return;
        }

        this.sendResponse(res, {
          requestId: session.requestId,
          type: 'result',
          data: result.output,
        });
        return;
      }

      this.sendResponse(res, {
        requestId: session.requestId,
        type: 'error',
        code: 'NO_OUTPUT',
        message: 'Skill did not produce output after clarification',
      });
    } catch (error) {
      this.sendResponse(res, {
        requestId: session.requestId,
        type: 'error',
        code: 'EXECUTION_ERROR',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  /**
   * Execute graph with timeout
   */
  private async executeWithTimeout(input: unknown, timeoutMs: number): Promise<GraphResult> {
    return Promise.race([
      this.graph!.invoke(input),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('TIMEOUT')), timeoutMs)
      ),
    ]);
  }

  /**
   * Convert answers array to map
   */
  private answersToMap(answers: ClarificationAnswer[]): Record<string, string | boolean> {
    const map: Record<string, string | boolean> = {};
    for (const answer of answers) {
      map[answer.questionId] = answer.answer;
    }
    return map;
  }

  /**
   * Read request body
   */
  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on('data', (chunk) => chunks.push(chunk));
      req.on('end', () => resolve(Buffer.concat(chunks).toString()));
      req.on('error', reject);
    });
  }

  /**
   * Send JSON response
   */
  private sendResponse(res: ServerResponse, response: ExecuteResponse): void {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(response));
  }

  /**
   * Send error response
   */
  private sendError(res: ServerResponse, status: number, code: string, message: string): void {
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', code, message }));
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupSessions(): void {
    const now = Date.now();
    for (const [id, session] of this.sessions) {
      if (now - session.createdAt > this.sessionTtlMs) {
        this.sessions.delete(id);
      }
    }
  }
}

/**
 * Create and start a skill host
 */
export async function createSkillHost(config: SkillHostConfig): Promise<SkillHost> {
  const host = new SkillHost(config);
  await host.start();
  return host;
}
