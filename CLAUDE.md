# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

**Crucible** — a VSCode extension (not the VSCode repo). It's a cost-optimized AI coding
assistant that orchestrates multiple LLM providers (OpenAI, Anthropic, Ollama) through an
adversarial plan → validate → execute → post-validate pipeline, with aggressive caching to
minimize tokens. The `src/vscode` directory name is incidental; the extension's identity is
`crucible` (see [package.json](package.json)).

## Commands

```bash
npm run dev          # vite build --watch (rebuild on change; reload Extension Dev Host to pick up)
npm run build        # production build into dist/
npm run check-types  # tsc --noEmit (type check only — build does not type-check)
npm run lint         # eslint extension/ src/
npm test             # vitest run (all tests once)
npm run test:watch   # vitest watch mode
npm run package      # vsce package → platform-specific .vsix
```

Run a single test file or pattern:
```bash
npx vitest run extension/orchestrator/__tests__/planner.test.ts
npx vitest run -t "refinePlan"        # by test name substring
```

To launch the extension: press **F5** in VSCode (Extension Development Host), then open the
Crucible beaker icon in the Activity Bar. Set API keys via the `Crucible: Set API Key` command
(stored in VSCode `context.secrets`, never in config).

## Two-process architecture

The extension has two separately-bundled halves that talk only via message passing:

- **Extension host** (`extension/`, Node environment) — all LLM calls, tools, caching, indexing,
  file I/O. Entry: [extension/index.ts](extension/index.ts) → `activate()`.
- **Webview UI** (`src/`, browser environment) — Vue 3 + Pinia + Tailwind. Entry:
  [src/main.ts](src/main.ts). Never has direct filesystem/network access.

Communication flow: webview posts a `{ type, ... }` message → [extension/webviewProvider.ts](extension/webviewProvider.ts)
→ the big `switch` in [extension/messageHandler.ts](extension/messageHandler.ts) (one `case` per
message type: `chat`, `planChat`, `agentChat`, `updateConfig`, `reindexAll`, session/plan CRUD,
etc.). The extension streams results back via `webview.postMessage`. When adding a UI-triggered
feature you almost always touch both a Vue component/store and a new `case` in `messageHandler.ts`.

Build wiring: Vite via `@tomjs/vite-plugin-vscode` bundles both halves ([vite.config.ts](vite.config.ts)).
Path aliases: `@` → `src`, `@ext` → `extension`.

## The orchestrator (Agent mode)

[extension/orchestrator/index.ts](extension/orchestrator/index.ts) runs a 4-role adversarial pipeline.
Each role maps to a provider+model via config `crucible.roles.<role>` (resolved by
`ProviderRegistry.getByRole`), so different phases can run on different/cheaper models:

1. **planner** generates a `Plan` of steps.
2. **validator** scores confidence and critiques; the planner **refinePlan**s and re-validates in a
   loop until `confidenceScore >= crucible.adversarial.confidenceThreshold` (default 0.7) or
   `crucible.adversarial.maxIterations` (default 3). In `runAgent`, failing to reach threshold
   aborts before execution.
3. **executor** runs each step's tool calls.
4. **postValidator** checks the results (gated by `crucible.adversarial.postValidation`).

Three entry modes: `runAgent` (full pipeline), `runPlanOnly` (Plan mode — planner+validator only,
no execution), `runAgentWithPlan` (execute a previously-saved plan, skipping planning). All take an
`onEvent` handler that emits phase/step events forwarded to the webview, and an `AbortSignal`
(cancellation is checked between every phase and step). `preflightCheck` verifies Ollama models are
pulled/reachable before starting long runs.

## Chat modes and tool policies

Three modes (`ChatMode = 'ask' | 'plan' | 'agent'` in [src/stores/chat.ts](src/stores/chat.ts)),
each backed by a tool-access policy in [extension/tools/policies.ts](extension/tools/policies.ts):

- **ask** / **plan** — read-only tools (`read_file`, `list_files`, `search_code`), no terminal.
- **agent** — adds `write_file`, `edit_file`, `run_command`, `spawn_agent`; writes/terminal require
  approval unless `crucible.terminal.requireApproval` is false. File read/write is sandboxed to the
  workspace via `fileReadPaths`/`fileWritePaths` glob policies.

Tools implement the `AgentTool` interface and are registered in [extension/tools/runner.ts](extension/tools/runner.ts).
`ToolRunner.getToolDefinitions()` filters the exposed tool set by the active policy — a tool not in
`policy.allowedTools` is invisible to the model, not just blocked. Terminal approval and allow/block
lists live in [extension/permissions.ts](extension/permissions.ts). `spawn_agent` launches isolated
sub-agents ([extension/agent/runner.ts](extension/agent/runner.ts)) with their own profile+policy.

## Caching & context (the "cost-optimized" part)

Persistent cache lives in `~/.crucible/<workspaceHash>/` (created on activate; `Crucible: Clear Cache`
wipes it). Layers under [extension/cache/](extension/cache/): file summaries, function signatures,
prompt fragments, retrieval cache, and `rollingMemory` (running intent/decision log). The
`ContextCompiler` ([extension/context/compiler.ts](extension/context/compiler.ts)) deliberately sends
**summaries instead of full file contents** to keep token counts down; the `ContextCollector` gathers
files for a query, honoring `@mentions` parsed in [extension/context/mentions.ts](extension/context/mentions.ts).

Semantic search: [extension/indexer/](extension/indexer/) chunks code (`code-chunk`), embeds it, and
stores vectors in `@lancedb/lancedb`. Long sessions auto-compact via
[extension/session/compaction.ts](extension/session/compaction.ts).

## Native dependencies constraint

`@lancedb/lancedb` and `code-chunk` are native/prebuilt modules. They are marked `external` in the
Vite build and shipped at runtime, which is why:
- Builds and `.vsix` packages are **platform-specific** (`darwin-arm64`, `linux-x64`, `win32-x64`;
  no Intel-Mac binary exists). See [scripts/prune-native-prebuilds.mjs](scripts/prune-native-prebuilds.mjs)
  and [scripts/verify-vsix.mjs](scripts/verify-vsix.mjs) (`npm run verify:vsix`).
- Tests must never load the real native module in unit context.

## Testing conventions

Vitest, configured in [vitest.config.ts](vitest.config.ts). Two environments split by path:
extension tests run in **node**, webview tests (`src/**`) in **happy-dom**. The critical alias:
`vscode` resolves to [extension/__mocks__/vscode.ts](extension/__mocks__/vscode.ts) so extension code
importing `vscode` is testable outside the editor. Other shared mocks live in
[extension/__mocks__/](extension/__mocks__/). Tests are colocated in `__tests__/` folders next to the
code they cover. `vi.hoisted()` uses `require()` (ESLint's `no-require-imports` is off for test files).

## Conventions worth knowing

- `strict` TypeScript, but `@typescript-eslint/no-explicit-any` is **off** — `any` is used
  intentionally at provider/SDK and webview message boundaries (see rationale in
  [eslint.config.js](eslint.config.js)).
- The executor signals step failure by returning `success: false`, **not** by throwing — handle both
  the returned result and thrown-error paths when touching execution flow.
- `.crucible/manifest.json` at repo root is a tool-generated file hash manifest; it is not source.
