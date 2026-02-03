/**
 * Remote Skill Client Demo
 *
 * Calls the invoice-processor skill via HTTP using RemoteSkillGateway.
 * Make sure to run server.ts first!
 */
import { config } from 'dotenv';
import { RemoteSkillGateway, type ClarificationAnswer } from '@saaas-poc/skill-gateway';

// Load environment variables
config();

const SKILL_ENDPOINT = process.env.SKILL_ENDPOINT ?? 'http://127.0.0.1:3001';

// Sample invoice text
const invoiceText = `
  INVOICE #INV-2024-002

  Vendor: TechCorp Solutions
  Date: February 1, 2024

  Items:
  - Software License x1 @ $299.99 = $299.99
  - Support Package x2 @ $50.00 = $100.00
  - Training Hours x5 @ $80.07 = $400.37

  Subtotal: $800.36
  Tax: $0.00
  Total: $800.36

  Currency: USD
  `;

interface InvoiceOutput {
  invoiceId: string;
  vendor: string;
  amount: number;
  currency: string;
  date?: string;
  lineItems?: Array<{
    description: string;
    quantity: number;
    unitPrice: number;
    total: number;
  }>;
}

async function main() {
  console.log('=== Remote Skill Client Demo ===\n');

  // 1. Create gateway with allowlist
  console.log('1. Creating RemoteSkillGateway...');
  console.log(`   Endpoint: ${SKILL_ENDPOINT}`);
  console.log(`   Allowlist: ["invoice-processor"]`);

  const gateway = new RemoteSkillGateway({
    allowedSkills: ['invoice-processor'],
    onClarificationNeeded: async (skillId, questions) => {
      console.log(`\n   Skill "${skillId}" needs clarification:`);
      const answers: ClarificationAnswer[] = [];
      for (const q of questions) {
        console.log(`   - ${q.questionText}`);
        if (q.options) {
          console.log(`     Options: ${q.options.join(', ')}`);
        }
        // Auto-answer for demo
        const answer = q.options?.[0] ?? 'USD';
        answers.push({ questionId: q.questionId, answer });
        console.log(`   → Auto-answered: ${answer}`);
      }
      return answers;
    },
  });
  console.log('   Gateway created!\n');

  // 2. Check health
  console.log('2. Checking server health...');
  const healthy = await gateway.healthCheck(SKILL_ENDPOINT);
  if (!healthy) {
    console.error('   Server is not healthy! Make sure server.ts is running.');
    process.exit(1);
  }
  console.log('   Server is healthy!\n');

  // 3. Fetch manifest
  console.log('3. Fetching skill manifest...');
  try {
    const manifest = await gateway.getManifest(SKILL_ENDPOINT);
    console.log(`   Skill: ${manifest.name} (${manifest.id})`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Timeout: ${manifest.limits.maxExecutionTimeMs}ms\n`);
  } catch (error) {
    console.error('   Failed to fetch manifest:', error);
    process.exit(1);
  }

  // 4. Execute skill
  console.log('4. Executing remote skill...');
  console.log('   (Invoice text length:', invoiceText.length, 'characters)\n');

  const result = await gateway.executeRemoteSkill<InvoiceOutput>(SKILL_ENDPOINT, {
    invoiceText,
  });

  // 5. Handle result
  if (result.success) {
    console.log('5. Success! Extracted invoice data:\n');
    console.log(JSON.stringify(result.data, null, 2));
  } else if (result.code === 'CLARIFICATION_NEEDED') {
    console.log('5. Clarification needed (not auto-handled):');
    console.log('   Session:', result.sessionId);
    console.log('   Questions:', JSON.stringify(result.questions, null, 2));
  } else {
    console.log('5. Error:', result.code);
    console.log('   Message:', result.error);
  }

  console.log('\n=== Demo Complete ===');
}

main().catch(console.error);
