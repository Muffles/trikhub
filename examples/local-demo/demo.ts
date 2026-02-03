/**
 * Local Skill Execution Demo
 *
 * Demonstrates loading and executing a skill locally via the LocalSkillGateway.
 */
import { config } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { LocalSkillGateway } from '@saaas-poc/skill-gateway';

// Load environment variables
config();

const __dirname = dirname(fileURLToPath(import.meta.url));

// Sample invoice text
const invoiceText = `
  INVOICE

  Invoice #: INV-2024-001
  Date: January 15, 2024

  From:
  TechCorp Solutions
  123 Tech Street
  San Francisco, CA 94102

  To:
  Acme Industries
  456 Business Ave
  New York, NY 10001

  Description                  Qty    Unit Price    Total
  -----------------------------------------------------------
  Cloud Hosting (Monthly)       1      $500.00     $500.00
  API Calls (1M requests)       2      $100.00     $200.00
  Premium Support               1      $150.00     $150.00
  -----------------------------------------------------------
                              Subtotal:            $850.00
                              Tax (10%):            $85.00
                              TOTAL:               $935.00

  Payment Terms: Net 30
  Currency: USD

  Thank you for your business!
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
  console.log('=== Local Skill Demo ===\n');

  // 1. Create gateway with clarification handler
  console.log('1. Creating LocalSkillGateway...');
  const gateway = new LocalSkillGateway({
    onClarificationNeeded: async (skillId, questions) => {
      console.log(`\n   Skill "${skillId}" needs clarification:`);
      const answers: Record<string, string | boolean> = {};
      for (const q of questions) {
        console.log(`   - ${q.questionText}`);
        if (q.options) {
          console.log(`     Options: ${q.options.join(', ')}`);
        }
        // Auto-answer for demo (in real app, would prompt user)
        answers[q.questionId] = q.options?.[0] ?? 'USD';
        console.log(`   → Auto-answered: ${answers[q.questionId]}`);
      }
      return answers;
    },
  });
  console.log('   Gateway created!\n');

  // 2. Load the skill
  console.log('2. Loading invoice-processor skill...');
  const skillPath = resolve(__dirname, '../skills/invoice-processor');

  try {
    const manifest = await gateway.loadSkill(skillPath);
    console.log(`   Loaded: ${manifest.name} (${manifest.id})`);
    console.log(`   Version: ${manifest.version}`);
    console.log(`   Can request clarification: ${manifest.capabilities.canRequestClarification}\n`);
  } catch (error) {
    console.error('   Failed to load skill:', error);
    console.error('\n   Make sure the skill is built first:');
    console.error('   cd examples/skills/invoice-processor && npx tsc');
    process.exit(1);
  }

  // 3. Execute the skill
  console.log('3. Executing skill with invoice text...');
  console.log('   (Invoice text length:', invoiceText.length, 'characters)\n');

  const result = await gateway.executeSkill<InvoiceOutput>('invoice-processor', {
    invoiceText,
  });

  // 4. Handle result
  if (result.success) {
    console.log('4. Success! Extracted invoice data:\n');
    console.log(JSON.stringify(result.data, null, 2));
  } else if (result.code === 'CLARIFICATION_NEEDED') {
    console.log('4. Clarification needed:');
    console.log('   Session:', result.sessionId);
    console.log('   Questions:', result.questions);
  } else {
    console.log('4. Error:', result.code);
    console.log('   Message:', result.error);
  }

  console.log('\n=== Demo Complete ===');
}

main().catch(console.error);
