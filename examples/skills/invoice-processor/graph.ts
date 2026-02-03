/**
 * Invoice Processor Skill - Pure LangGraph Implementation
 *
 * This is a standard LangGraph project. No custom framework imports.
 * The skill contract is defined in manifest.json.
 */
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';

// ============================================
// Types
// ============================================

interface InvoiceInput {
  invoiceText: string;
}

interface LineItem {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
}

interface InvoiceData {
  invoiceId: string;
  vendor: string;
  amount: number;
  currency: string;
  date?: string;
  lineItems?: LineItem[];
}

interface ClarificationQuestion {
  questionId: string;
  questionText: string;
  questionType: 'text' | 'multiple_choice' | 'boolean';
  options?: string[];
}

// ============================================
// State Definition (using Annotation)
// ============================================

const InvoiceState = Annotation.Root({
  // Input from gateway
  input: Annotation<InvoiceInput>,

  // Clarification answers (if provided)
  clarificationAnswers: Annotation<Record<string, string | boolean> | undefined>,

  // Internal state
  extractedData: Annotation<InvoiceData | undefined>,
  needsClarification: Annotation<boolean>,
  clarificationQuestion: Annotation<ClarificationQuestion | undefined>,

  // Output to gateway
  output: Annotation<InvoiceData | undefined>,
});

type InvoiceStateType = typeof InvoiceState.State;

// ============================================
// LLM Setup (lazy initialization)
// ============================================

let _model: ChatAnthropic | null = null;

function getModel(): ChatAnthropic {
  if (!_model) {
    _model = new ChatAnthropic({
      model: 'claude-sonnet-4-20250514',
      maxTokens: 1024,
    });
  }
  return _model;
}

// ============================================
// Graph Nodes
// ============================================

/**
 * Extract invoice data from text using LLM
 */
async function extractNode(state: InvoiceStateType): Promise<Partial<InvoiceStateType>> {
  const prompt = `Extract structured invoice data from the following text. Return a JSON object with these fields:
    - invoiceId (string): The invoice number/ID
    - vendor (string): The company/vendor name
    - amount (number): The total amount as a number (no currency symbol)
    - currency (string): The 3-letter currency code (e.g., USD, EUR, GBP)
    - date (string, optional): The invoice date in ISO format if found
    - lineItems (array, optional): Array of line items with description, quantity, unitPrice, total

    Invoice text:
    ${state.input.invoiceText}

    Return ONLY the JSON object, no other text.`;

  const response = await getModel().invoke(prompt);
  const content = typeof response.content === 'string' ? response.content : '';

  try {
    // Extract JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      throw new Error('No JSON found in response');
    }
    const data = JSON.parse(jsonMatch[0]) as InvoiceData;
    return { extractedData: data };
  } catch {
    // If parsing fails, return partial data
    return {
      extractedData: {
        invoiceId: 'UNKNOWN',
        vendor: 'UNKNOWN',
        amount: 0,
        currency: 'USD',
      },
    };
  }
}

/**
 * Validate extracted data and determine if clarification is needed
 */
async function validateNode(state: InvoiceStateType): Promise<Partial<InvoiceStateType>> {
  const data = state.extractedData;

  if (!data) {
    return {
      needsClarification: true,
      clarificationQuestion: {
        questionId: 'retry',
        questionText: 'Could not extract invoice data. Please provide the invoice in a cleaner format.',
        questionType: 'text',
      },
    };
  }

  // Check if we already have clarification answers
  if (state.clarificationAnswers) {
    // Apply clarification answers
    const answers = state.clarificationAnswers;
    const updatedData = { ...data };

    if (answers.currency && typeof answers.currency === 'string') {
      updatedData.currency = answers.currency;
    }

    return {
      output: updatedData,
      needsClarification: false,
    };
  }

  // Check if currency is ambiguous
  if (!data.currency || data.currency === 'UNKNOWN') {
    return {
      needsClarification: true,
      clarificationQuestion: {
        questionId: 'currency',
        questionText: 'What currency is this invoice in?',
        questionType: 'multiple_choice',
        options: ['USD', 'EUR', 'GBP', 'Other'],
      },
    };
  }

  // All good - return output
  return {
    output: data,
    needsClarification: false,
  };
}

/**
 * Determine next step based on validation
 */
function shouldContinue(state: InvoiceStateType): string {
  if (state.needsClarification) {
    return END; // Stop and return clarification question
  }
  return END; // Stop with output
}

// ============================================
// Build Graph
// ============================================

const workflow = new StateGraph(InvoiceState)
  .addNode('extract', extractNode)
  .addNode('validate', validateNode)
  .addEdge(START, 'extract')
  .addEdge('extract', 'validate')
  .addConditionalEdges('validate', shouldContinue);

// Export the compiled graph
export default workflow.compile();
