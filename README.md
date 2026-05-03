# Maestro

Maestro is the conductor for your AI agent team: it keeps specialists aligned, coordinates execution, and helps turn ideas into shipped software with clarity.

CLI orchestrator for AI agents that build software collaboratively.

Maestro helps you go from idea to implementation with a structured workflow:
1. Architect-led discovery and planning (ARCH-001 to ARCH-005)
2. Backlog generation with dependencies and acceptance criteria
3. Agent-driven task execution with persistent project state

## Highlights

- Structured orchestration model designed for collaborative software delivery
- Structured architecture and planning phases before coding
- Backlog with prerequisites, task statuses, and assignees
- Provider support for Claude, Copilot, and Codex modes
- Persistent runtime state in SQLite plus JSON/YAML artifacts
- VS Code extension auto-install (when bundled and editor CLI is available)

## Requirements

- Node.js 22+
- tmux
- One provider CLI, depending on selected mode:
  - Claude mode: Claude Code CLI (`claude`)
  - Copilot mode: GitHub Copilot CLI (`copilot`)
  - Codex mode: OpenAI Codex CLI (`codex`)

During `maestro init`, prerequisites are checked automatically.

## Installation

Install from source in this repository:

```bash
npm install
npm run build
npm link
```

Then verify:

```bash
maestro --version
```

## Quick Start

Inside your project directory:

```bash
maestro init
maestro backlog
maestro start
```

What happens on init:

- Creates project docs folder
- Creates provider-native agents folder
- Creates runtime state folder and seeds ARCH tasks
- Appends `.maestro/` to `.gitignore`

Default flow:

1. `maestro init` initializes project state and ARCH-001 as ready
2. `maestro start` (or `maestro run`) executes the next ready task
3. `maestro mark-done <taskId>` validates artifacts, marks done, and promotes successors
4. Repeat until all tasks are complete

## CLI Commands

### Project setup and status

```bash
maestro init [--force] [--provider claude|copilot|codex]
maestro status
maestro reset [--hard]
```

- `init`: bootstraps Maestro in current directory
- `status`: shows backlog summary, per-agent breakdown, total LLM cost
- `reset`: removes runtime state; `--hard` also removes docs and agents artifacts

### Backlog and execution

```bash
maestro backlog [taskId]
maestro start
maestro run [taskId]
maestro next-task
maestro task-context <taskId>
maestro mark-done <taskId>
```

- `backlog`: list all tasks or show details for one task
- `start`: run next ready task
- `run`: legacy one-shot execution entrypoint
- `next-task`: pick next runnable task and print execution context
- `task-context`: print full context for a specific runnable task
- `mark-done`: verify expected artifacts, mark task complete, promote dependents

### Agent interaction and observability

```bash
maestro agents
maestro agent <name>
maestro chat <agent>
maestro stop <agent>
maestro docs
maestro logs <taskId>
maestro cost [--since <ISO_DATE>]
```

- `agents`: list agent profiles and metadata
- `agent`: print one agent definition file
- `chat`: open an interactive session with an agent
- `stop`: stop an agent session and mark in-progress task(s) as failed
- `docs`: list generated docs files
- `logs`: show transcript for a task session
- `cost`: show per-task/model token and USD usage

## Project Layout (after init)

```text
<project>/
├── docs/
├── .maestro/
│   ├── config.yaml
│   ├── state.db
│   ├── backlog.json
│   ├── events.log
│   └── sessions/
├── .agents/
│   ├── _base/
│   └── _archive/
├── .claude/agents/           # provider=claude
├── .github/agents/           # provider=copilot
└── .codex/agents/            # provider=codex
```

Notes:

- Runtime data lives in `.maestro/` and is intended to be gitignored
- Agent templates for staffing live in `.agents/_base/`
- Active provider determines where runtime agent persona files are created

## Provider Modes

Configured in `.maestro/config.yaml` as `provider_mode`.

Resolution order used by Maestro:

1. Agent frontmatter
2. Project config
3. Global config (`~/.maestro/config.yaml`)
4. Hardcoded defaults

## Development

Useful commands in this repository:

```bash
npm run dev
npm run build
npm run typecheck
npm test
npm run build:vsix
```

## Troubleshooting

- Not in a Maestro project:
  - Run `maestro init` in your project root first
- No ready tasks:
  - Check `maestro backlog` for blocked/pending prerequisites
- Provider CLI not found:
  - Install and authenticate the corresponding CLI (`claude`, `copilot`, or `codex`)
- Native module issues (`better-sqlite3`):
  - Rebuild with your current Node version (`npm rebuild better-sqlite3`)

## License

MIT
