# Crucible

A cost-optimized AI coding assistant for VSCode with adversarial validation, multi-model orchestration, and intelligent caching.

## Features

- **Quick Chat** -- Single-model conversational mode for fast questions
- **Agent Mode** -- Orchestrated pipeline: Opus plans, Qwen validates, Qwen executes
- **Multi-Layer Caching** -- File summaries, function signatures, prompt fragments stored in `~/.crucible/`
- **Context Compiler** -- Minimizes token usage by sending summaries instead of full files
- **Adversarial Validation** -- Forces disagreement between models before execution
- **Multi-Provider** -- OpenAI, Anthropic, Ollama, and any OpenAI-compatible endpoint
- **MCP Support** -- Connect to Model Context Protocol servers for extended tool use
- **Terminal Permissions** -- Configurable allow/block lists with approval dialogs

## Getting Started

1. Install dependencies: `npm install`
2. Build: `npm run build`
3. Press F5 in VSCode to launch the Extension Development Host
4. Click the Crucible beaker icon in the Activity Bar
5. Set your API keys via `Crucible: Set API Key` command

## Installing a build

Prebuilt `.vsix` files are attached to each [GitHub release](../../releases), and
every run of the Release workflow uploads them as downloadable build artifacts.
They are unsigned, so install them directly:

```bash
code --install-extension crucible-0.1.0-darwin-arm64.vsix
```

Or in VSCode: **Extensions** → **⋯** → **Install from VSIX…**

Builds are platform-specific because the semantic indexer depends on a native
module (`@lancedb/lancedb`). Pick the one matching your machine:

| Target | Use on |
| --- | --- |
| `darwin-arm64` | Apple Silicon Macs |
| `linux-x64` | Intel/AMD Linux |
| `win32-x64` | Intel/AMD Windows |

Intel Macs are not currently supported, as `@lancedb/lancedb` publishes no
`darwin-x64` binary.

## Development

```bash
npm run dev          # Watch mode with HMR
npm run build        # Production build
npm run lint         # ESLint
npm run check-types  # tsc --noEmit
npm test             # Vitest
npm run package      # Build a .vsix for the current platform
```

## Configuration

Configure models, roles, and permissions in VSCode settings under `crucible.*`.
