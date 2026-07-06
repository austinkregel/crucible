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

## Development

```bash
npm run dev    # Watch mode with HMR
npm run build  # Production build
```

## Configuration

Configure models, roles, and permissions in VSCode settings under `crucible.*`.
