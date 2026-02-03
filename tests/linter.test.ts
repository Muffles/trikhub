import { describe, it, expect } from 'vitest';
import ts from 'typescript';
import {
  getImports,
  checkForbiddenImports,
  checkDynamicCodeExecution,
  findToolUsage,
  FORBIDDEN_IMPORTS,
} from '../packages/skill-linter/src/rules.js';

function createSourceFile(code: string): ts.SourceFile {
  return ts.createSourceFile('test.ts', code, ts.ScriptTarget.ESNext, true, ts.ScriptKind.TS);
}

describe('skill-linter rules', () => {
  describe('getImports', () => {
    it('should extract static imports', () => {
      const code = `
        import { foo } from 'bar';
        import baz from 'qux';
        import * as all from 'everything';
      `;
      const sf = createSourceFile(code);
      const imports = getImports(sf);

      expect(imports).toContain('bar');
      expect(imports).toContain('qux');
      expect(imports).toContain('everything');
    });

    it('should extract dynamic imports', () => {
      const code = `
        const mod = await import('dynamic-module');
      `;
      const sf = createSourceFile(code);
      const imports = getImports(sf);

      expect(imports).toContain('dynamic-module');
    });
  });

  describe('checkForbiddenImports', () => {
    it('should detect forbidden imports', () => {
      const code = `
        import fs from 'fs';
        import { spawn } from 'child_process';
        import { ChatAnthropic } from '@langchain/anthropic';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(2);
      expect(results.some(r => r.message.includes('fs'))).toBe(true);
      expect(results.some(r => r.message.includes('child_process'))).toBe(true);
    });

    it('should detect node: prefixed imports', () => {
      const code = `
        import fs from 'node:fs';
        import { createServer } from 'node:http';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(2);
    });

    it('should allow safe imports', () => {
      const code = `
        import { StateGraph } from '@langchain/langgraph';
        import { ChatAnthropic } from '@langchain/anthropic';
        import { z } from 'zod';
      `;
      const sf = createSourceFile(code);
      const results = checkForbiddenImports(sf);

      expect(results.length).toBe(0);
    });
  });

  describe('checkDynamicCodeExecution', () => {
    it('should detect eval usage', () => {
      const code = `
        const result = eval('1 + 1');
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(1);
      expect(results[0].rule).toBe('no-dynamic-code');
      expect(results[0].message).toContain('eval');
    });

    it('should detect Function constructor', () => {
      const code = `
        const fn = new Function('a', 'return a + 1');
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(1);
      expect(results[0].message).toContain('Function');
    });

    it('should not flag normal function calls', () => {
      const code = `
        function myFunc() { return 1; }
        const result = myFunc();
      `;
      const sf = createSourceFile(code);
      const results = checkDynamicCodeExecution(sf);

      expect(results.length).toBe(0);
    });
  });

  describe('findToolUsage', () => {
    it('should find tool() calls', () => {
      const code = `
        const myTool = tool("calculator", {
          description: "A calculator",
        });
      `;
      const sf = createSourceFile(code);
      const tools = findToolUsage(sf);

      expect(tools).toContain('calculator');
    });
  });
});
