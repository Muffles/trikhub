# Software as AI Skill - POC

A simplified framework for AI agents to safely consume third-party "skills" without prompt injection risks.

## Core Insight

A skill is just a **LangGraph project** + a **manifest.json** file. Security comes from:
1. **Separate invocation** - The skill's graph runs in its own LLM context
2. **Schema validation** - Input/output validated at the boundary

No custom runtime. No complex sandboxing. Just separation + validation.

## Quick Start

```bash
# Install dependencies
pnpm install

# Build
pnpm build

# Run tests
pnpm test

export ANTHROPIC_API_KEY=a-working-key
pnpm --filter @saaas-poc/examples local-demo

# Terminal 1:
pnpm --filter @saaas-poc/examples remote:server
# Terminal 2:
pnpm --filter @saaas-poc/examples remote:client
```

## What A Skill Looks Like

A skill is a folder with a manifest and LangGraph code:

```
my-skill/
├── manifest.json    ← The contract (schemas, capabilities, limits)
└── graph.ts         ← Standard LangGraph code (no custom imports)
```

### manifest.json

```json
{
  "id": "invoice-processor",
  "name": "Invoice Processor",
  "description": "Extracts structured data from invoices",
  "version": "1.0.0",

  "inputSchema": {
    "type": "object",
    "properties": {
      "invoiceText": { "type": "string" }
    },
    "required": ["invoiceText"]
  },

  "outputSchema": {
    "type": "object",
    "properties": {
      "invoiceId": { "type": "string" },
      "vendor": { "type": "string" },
      "amount": { "type": "number" },
      "currency": { "type": "string" }
    },
    "required": ["invoiceId", "vendor", "amount", "currency"]
  },

  "capabilities": {
    "tools": [],
    "canRequestClarification": true
  },

  "limits": {
    "maxExecutionTimeMs": 30000,
    "maxLlmCalls": 5,
    "maxToolCalls": 10
  },

  "entry": {
    "module": "./graph.js",
    "export": "default"
  }
}
```

### graph.ts

```typescript
import { StateGraph, END, START, Annotation } from '@langchain/langgraph';
import { ChatAnthropic } from '@langchain/anthropic';

// State definition
const MyState = Annotation.Root({
  input: Annotation<{ invoiceText: string }>,
  output: Annotation<InvoiceData | undefined>,
});

// Nodes
async function processNode(state: typeof MyState.State) {
  // Your LangGraph logic here
  return { output: extractedData };
}

// Build and export graph
const workflow = new StateGraph(MyState)
  .addNode('process', processNode)
  .addEdge(START, 'process')
  .addEdge('process', END);

export default workflow.compile();
```

## Architecture

### Packages

```
┌─────────────────────────────────────────────────────────────────┐
│                        skill-manifest                            │
│  • SkillManifest type (the contract)                            │
│  • Wire protocol types (ExecuteRequest, ExecuteResponse, etc.)  │
│  • ajv-based validation (validateManifest, SchemaValidator)     │
└─────────────────────────────────────────────────────────────────┘
                              ▲
                              │ depends on
        ┌─────────────────────┴─────────────────────┐
        │                                           │
┌───────┴───────┐                         ┌────────┴────────┐
│ skill-gateway │                         │   skill-host    │
│               │                         │                 │
│ LocalGateway  │◄─── same logic ────────►│  HTTP Server    │
│ RemoteGateway │                         │  wraps gateway  │
└───────────────┘                         └─────────────────┘
        │
        │ uses
        ▼
┌───────────────┐
│ skill-linter  │
│               │
│ Verifies that │
│ manifest      │
│ matches code  │
└───────────────┘
```

| Package | Purpose |
|---------|---------|
| `skill-manifest` | Types + ajv validation |
| `skill-gateway` | Local + Remote gateways |
| `skill-host` | HTTP server for hosting skills |
| `skill-linter` | Manifest ↔ code verification |

### Local Execution Flow

```
┌──────────────┐      ┌──────────────────┐      ┌─────────────────┐
│   Your App   │      │  LocalGateway    │      │  Skill (Graph)  │
└──────┬───────┘      └────────┬─────────┘      └────────┬────────┘
       │                       │                         │
       │ loadSkill(path)       │                         │
       │──────────────────────►│                         │
       │                       │ read manifest.json      │
       │                       │ import graph.ts         │
       │                       │◄────────────────────────│
       │                       │                         │
       │ executeSkill(id,input)│                         │
       │──────────────────────►│                         │
       │                       │ 1. validate input       │
       │                       │    (ajv vs inputSchema) │
       │                       │                         │
       │                       │ 2. graph.invoke({input})│
       │                       │────────────────────────►│
       │                       │                         │ LLM calls
       │                       │                         │ (separate
       │                       │        {output}         │  context)
       │                       │◄────────────────────────│
       │                       │                         │
       │                       │ 3. validate output      │
       │                       │    (ajv vs outputSchema)│
       │                       │                         │
       │      {success, data}  │                         │
       │◄──────────────────────│                         │
```

**Key point**: Step 2 is where isolation happens. The graph runs as its own LLM invocation - it cannot see your app's conversation history.

### Remote Execution Flow

```
┌──────────────┐     ┌───────────────┐     ┌─────────────┐     ┌───────────┐
│   Your App   │     │ RemoteGateway │     │ SkillHost   │     │   Graph   │
└──────┬───────┘     └───────┬───────┘     └──────┬──────┘     └─────┬─────┘
       │                     │                    │                  │
       │ executeRemoteSkill  │                    │                  │
       │ (endpoint, input)   │                    │                  │
       │────────────────────►│                    │                  │
       │                     │                    │                  │
       │                     │ GET /manifest      │                  │
       │                     │───────────────────►│                  │
       │                     │    SkillManifest   │                  │
       │                     │◄───────────────────│                  │
       │                     │                    │                  │
       │                     │ check allowlist    │                  │
       │                     │ validate input     │                  │
       │                     │                    │                  │
       │                     │ POST /execute      │                  │
       │                     │ {requestId, input} │                  │
       │                     │───────────────────►│                  │
       │                     │                    │ validate input   │
       │                     │                    │ graph.invoke()   │
       │                     │                    │─────────────────►│
       │                     │                    │     {output}     │
       │                     │                    │◄─────────────────│
       │                     │                    │ validate output  │
       │                     │  {type: "result",  │                  │
       │                     │   data: output}    │                  │
       │                     │◄───────────────────│                  │
       │                     │                    │                  │
       │                     │ validate output    │                  │
       │  {success, data}    │ (double-check)     │                  │
       │◄────────────────────│                    │                  │
```

**Security layers**:
1. **Allowlist** - Gateway only calls skills in `allowedSkills[]`
2. **Input validation** - Done by both gateway AND host
3. **Output validation** - Done by both host AND gateway
4. **Timeout** - Gateway enforces `limits.maxExecutionTimeMs`

### HTTP Protocol

Remote skills expose these endpoints:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/manifest` | GET | Returns SkillManifest |
| `/execute` | POST | Execute skill with `{requestId, input}` |
| `/clarify` | POST | Continue with `{sessionId, answers}` |
| `/health` | GET | Health check |

## Clarification Flow

When a skill needs user input mid-execution:

```
Gateway                          Skill
   │                               │
   │      graph.invoke({input})    │
   │──────────────────────────────►│
   │                               │
   │  {needsClarification: true,   │
   │   clarificationQuestion: {    │
   │     questionId: "currency",   │
   │     questionText: "...",      │
   │     options: ["USD","EUR"]    │
   │   }}                          │
   │◄──────────────────────────────│
   │                               │
   │  (gateway returns to app)     │
   │  (app asks user)              │
   │  (user answers "USD")         │
   │                               │
   │  graph.invoke({input,         │
   │    clarificationAnswers: {    │
   │      currency: "USD"          │
   │    }})                        │
   │──────────────────────────────►│
   │                               │
   │      {output: {...}}          │
   │◄──────────────────────────────│
```

## Security Model

| Concern | Mitigation |
|---------|------------|
| Skill can't see agent context | Separate graph invocation |
| Skill can't return arbitrary data | Output validated against schema |
| Skill can't use undeclared tools | Linter verifies manifest matches code |
| Skill can't run forever | Timeout in gateway |
| Allowlist controls access | Gateway checks before loading/calling |

## Usage Examples

### Local Skill Execution

```typescript
import { LocalSkillGateway } from '@saaas-poc/skill-gateway';

const gateway = new LocalSkillGateway({
  onClarificationNeeded: async (skillId, questions) => {
    // Prompt user for answers
    return { currency: 'USD' };
  },
});

// Load skill
await gateway.loadSkill('./skills/invoice-processor');

// Execute
const result = await gateway.executeSkill('invoice-processor', {
  invoiceText: 'Invoice #123...',
});

if (result.success) {
  console.log(result.data);
}
```

### Remote Skill Execution

```typescript
import { RemoteSkillGateway } from '@saaas-poc/skill-gateway';

const gateway = new RemoteSkillGateway({
  allowedSkills: ['invoice-processor'],
  onClarificationNeeded: async (skillId, questions) => {
    return [{ questionId: 'currency', answer: 'USD' }];
  },
});

const result = await gateway.executeRemoteSkill(
  'http://localhost:3001',
  { invoiceText: 'Invoice #123...' }
);
```

### Hosting a Skill

```typescript
import { SkillHost } from '@saaas-poc/skill-host';

const host = new SkillHost({
  skillPath: './skills/invoice-processor',
  port: 3001,
});

await host.start();
// Server running at http://localhost:3001
```

## Linting Skills

```bash
# Lint a skill
pnpm lint:skill ./examples/skills/invoice-processor
```

The linter checks:
- `valid-manifest` - Manifest is valid JSON matching schema
- `no-forbidden-imports` - Blocks `fs`, `child_process`, `net`, etc.
- `no-dynamic-code` - Blocks `eval()` and `Function` constructor
- `undeclared-tool` - Tools used must be declared in manifest

## Project Structure

```
saaas-poc/
├── packages/
│   ├── skill-manifest/     # Types + validation
│   ├── skill-gateway/      # Local + Remote gateways
│   ├── skill-host/         # HTTP server
│   └── skill-linter/       # Static analysis
├── examples/
│   ├── skills/
│   │   └── invoice-processor/
│   ├── local-demo/
│   └── remote-demo/
└── tests/
```

## Future iteration
- Multi-Action Skills. The current architecture assumes one skill = one entry point. This needs to change. A skill should expose multiple actions (like a SaaS with multiple API endpoints). 