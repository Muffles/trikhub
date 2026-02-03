import type {
  SkillManifest,
  ExecuteRequest,
  ExecuteResponse,
  ClarifyRequest,
  ClarificationAnswer,
} from '@saaas-poc/skill-manifest';

/**
 * HTTP client for communicating with remote skill hosts
 */
export class RemoteSkillClient {
  private manifestCache = new Map<string, { manifest: SkillManifest; fetchedAt: number }>();
  private cacheTtlMs = 5 * 60 * 1000; // 5 minutes

  /**
   * Fetch manifest from a remote skill endpoint
   */
  async fetchManifest(endpoint: string, skipCache = false): Promise<SkillManifest> {
    const cacheKey = endpoint;

    // Check cache
    if (!skipCache) {
      const cached = this.manifestCache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < this.cacheTtlMs) {
        return cached.manifest;
      }
    }

    const url = new URL('/manifest', endpoint).href;
    const response = await fetch(url, {
      method: 'GET',
      headers: { 'Accept': 'application/json' },
    });

    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`);
    }

    const manifest = (await response.json()) as SkillManifest;

    // Cache it
    this.manifestCache.set(cacheKey, { manifest, fetchedAt: Date.now() });

    return manifest;
  }

  /**
   * Execute a skill on a remote host
   */
  async execute(
    endpoint: string,
    input: unknown,
    timeoutMs: number = 30000
  ): Promise<ExecuteResponse> {
    const url = new URL('/execute', endpoint).href;
    const requestId = crypto.randomUUID();

    const request: ExecuteRequest = {
      requestId,
      input,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          requestId,
          type: 'error',
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return (await response.json()) as ExecuteResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          requestId,
          type: 'error',
          code: 'TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms`,
        };
      }

      return {
        requestId,
        type: 'error',
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }

  /**
   * Send clarification answers to a remote skill
   */
  async clarify(
    endpoint: string,
    sessionId: string,
    answers: ClarificationAnswer[],
    timeoutMs: number = 30000
  ): Promise<ExecuteResponse> {
    const url = new URL('/clarify', endpoint).href;

    const request: ClarifyRequest = {
      sessionId,
      answers,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        return {
          requestId: sessionId,
          type: 'error',
          code: 'HTTP_ERROR',
          message: `HTTP ${response.status}: ${response.statusText}`,
        };
      }

      return (await response.json()) as ExecuteResponse;
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        return {
          requestId: sessionId,
          type: 'error',
          code: 'TIMEOUT',
          message: `Request timed out after ${timeoutMs}ms`,
        };
      }

      return {
        requestId: sessionId,
        type: 'error',
        code: 'NETWORK_ERROR',
        message: error instanceof Error ? error.message : 'Unknown network error',
      };
    }
  }

  /**
   * Check if a remote skill host is healthy
   */
  async healthCheck(endpoint: string, timeoutMs: number = 5000): Promise<boolean> {
    const url = new URL('/health', endpoint).href;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(url, {
        method: 'GET',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      return response.ok;
    } catch {
      clearTimeout(timeoutId);
      return false;
    }
  }

  /**
   * Clear the manifest cache
   */
  clearCache(): void {
    this.manifestCache.clear();
  }
}
