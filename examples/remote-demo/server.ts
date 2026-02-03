/**
 * Remote Skill Server Demo
 *
 * Hosts the invoice-processor skill as an HTTP service.
 * Run this first, then run client.ts in another terminal.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SkillHost } from '@saaas-poc/skill-host';

// Load environment variables
config();

const __dirname = dirname(fileURLToPath(import.meta.url));

const PORT = parseInt(process.env.SKILL_PORT ?? '3001', 10);
const HOST = process.env.SKILL_HOST ?? '127.0.0.1';

async function main() {
  console.log('=== Remote Skill Server ===\n');

  const skillPath = resolve(__dirname, '../skills/invoice-processor');
  console.log(`Loading skill from: ${skillPath}`);

  const host = new SkillHost({
    skillPath,
    port: PORT,
    host: HOST,
  });

  try {
    await host.start();
    console.log(`\nServer ready!`);
    console.log(`  Manifest: http://${HOST}:${PORT}/manifest`);
    console.log(`  Execute:  POST http://${HOST}:${PORT}/execute`);
    console.log(`  Clarify:  POST http://${HOST}:${PORT}/clarify`);
    console.log(`  Health:   http://${HOST}:${PORT}/health`);
    console.log(`\nPress Ctrl+C to stop.\n`);
  } catch (error) {
    console.error('Failed to start server:', error);
    console.error('\nMake sure the skill is built first:');
    console.error('  cd examples/skills/invoice-processor && npx tsc');
    process.exit(1);
  }

  // Handle graceful shutdown
  process.on('SIGINT', async () => {
    console.log('\nShutting down...');
    await host.stop();
    process.exit(0);
  });
}

main().catch(console.error);
