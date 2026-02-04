#!/usr/bin/env node
/**
 * Type-Directed Privilege Separation Demo
 *
 * This demo shows how skills return separated data:
 * - agentData: Structured data (enums, integers) for agent reasoning
 * - userContent: Free text for display (may contain injection attempts)
 *
 * Run with: pnpm demo
 * Run with debug: pnpm demo:debug or DEBUG=true pnpm demo
 */

import * as readline from 'node:readline';
import { PrivilegeSeparatedAgent } from './agent.js';

const DEBUG = process.env.DEBUG === 'true';

async function main() {
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('  Type-Directed Privilege Separation Demo');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log();
  console.log('This demo shows how an agent safely processes skill responses:');
  console.log('• Decision Node: Only sees structured agentData (no free text)');
  console.log('• Render Node: Fills templates + displays userContent (no tools)');
  console.log();
  console.log('Try searching for: AI, technology, science, health, business');
  console.log('One article contains a prompt injection attempt in its title.');
  console.log('Notice how the agent is NOT affected by it.');
  console.log();
  if (DEBUG) {
    console.log('[DEBUG MODE ENABLED - showing internal flow]');
    console.log();
  }
  console.log('Type "quit" or "exit" to stop.');
  console.log('───────────────────────────────────────────────────────────────');

  // Initialize agent
  const agent = new PrivilegeSeparatedAgent({ debug: DEBUG });

  try {
    await agent.loadSkill();
  } catch (error) {
    console.error('Failed to load skill:', error);
    process.exit(1);
  }

  // Interactive loop
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const askQuestion = () => {
    rl.question('\nWhat would you like to search for? ', async (input) => {
      const trimmed = input.trim();

      if (!trimmed) {
        askQuestion();
        return;
      }

      if (trimmed.toLowerCase() === 'quit' || trimmed.toLowerCase() === 'exit') {
        console.log('\nGoodbye!');
        rl.close();
        return;
      }

      try {
        const response = await agent.processQuery(trimmed);
        console.log();
        console.log('───────────────────────────────────────────────────────────────');
        console.log('RESPONSE:');
        console.log(response);
        console.log('───────────────────────────────────────────────────────────────');
      } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : error);
      }

      askQuestion();
    });
  };

  askQuestion();
}

main().catch(console.error);
