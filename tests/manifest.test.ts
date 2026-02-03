import { describe, it, expect } from 'vitest';
import {
  validateManifest,
  validateData,
  SchemaValidator,
  type SkillManifest,
} from '../packages/skill-manifest/src/index.js';

describe('skill-manifest', () => {
  describe('validateManifest', () => {
    it('should validate a complete manifest', () => {
      const manifest: SkillManifest = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        inputSchema: { type: 'object', properties: { input: { type: 'string' } } },
        outputSchema: { type: 'object', properties: { output: { type: 'string' } } },
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(true);
    });

    it('should reject manifest with missing required fields', () => {
      const manifest = {
        id: 'test-skill',
        // missing other required fields
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
    });

    it('should reject manifest with invalid version format', () => {
      const manifest = {
        id: 'test-skill',
        name: 'Test',
        description: 'Test',
        version: 'not-semver', // invalid
        inputSchema: {},
        outputSchema: {},
        capabilities: { tools: [], canRequestClarification: false },
        limits: { maxExecutionTimeMs: 30000, maxLlmCalls: 5, maxToolCalls: 10 },
        entry: { module: './graph.js', export: 'default' },
      };

      const result = validateManifest(manifest);
      expect(result.valid).toBe(false);
    });
  });

  describe('validateData', () => {
    it('should validate data against schema', () => {
      const schema = {
        type: 'object',
        properties: {
          name: { type: 'string' },
          age: { type: 'number' },
        },
        required: ['name'],
      };

      expect(validateData(schema, { name: 'John', age: 30 }).valid).toBe(true);
      expect(validateData(schema, { name: 'John' }).valid).toBe(true);
      expect(validateData(schema, { age: 30 }).valid).toBe(false); // missing name
      expect(validateData(schema, { name: 123 }).valid).toBe(false); // wrong type
    });
  });

  describe('SchemaValidator', () => {
    it('should cache validators', () => {
      const validator = new SchemaValidator();
      const schema = { type: 'string' };

      const v1 = validator.getValidator('test', schema);
      const v2 = validator.getValidator('test', schema);

      expect(v1).toBe(v2); // same instance
    });

    it('should validate with cached validator', () => {
      const validator = new SchemaValidator();
      const schema = { type: 'number', minimum: 0 };

      expect(validator.validate('test', schema, 5).valid).toBe(true);
      expect(validator.validate('test', schema, -1).valid).toBe(false);
    });
  });
});
