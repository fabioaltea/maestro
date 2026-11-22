# Implementation inventory — T001

**Data**: 2026-11-08
**Branch**: `001-core-background-daemon-implementation`
**Baseline approvata**: `dd0d7c11e19ac57f2aa477fed72d1989f2ca8b60`
**Ultima revisione precedente**: `eb7790933d32420afd10ca8033e0234a2c5d3b5e`

## File da preservare

Preservare `.agents/`, `.specify/`, `AGENTS.md`, `docs/product-brief.md` e tutti gli
artefatti `specs/001-core-background-daemon/`. Non reintrodurre codice legacy o convenzioni
dalla storia Git. Nessun segreto, file locale o `.DS_Store` deve essere aggiunto ai commit.

## Stato iniziale

Prima della baseline erano presenti 71 cancellazioni della precedente implementazione
e i nuovi artefatti di specifica non tracciati. La richiesta esplicita di commit ha
salvato tali cambiamenti nella baseline sopra. Nessun file è stato cancellato durante
T001. Dopo il commit iniziale resta soltanto `.DS_Store` non tracciato; verrà ignorato.
Non risultano modifiche locali di codice da incorporare o sovrascrivere.

## Cancellazioni preesistenti registrate nella baseline

- `.gitignore`
- `LICENSE`
- `README.md`
- `bin/maestro`
- `maestro-v1-technical-brief.md`
- `package.json`
- `pnpm-lock.yaml`
- `scripts/postinstall.js`
- `src/agents/architect/runner.ts`
- `src/agents/architect/tools.ts`
- `src/cli/commands/_notImplemented.ts`
- `src/cli/commands/_run-agent.ts`
- `src/cli/commands/agent.ts`
- `src/cli/commands/agents.ts`
- `src/cli/commands/backlog.ts`
- `src/cli/commands/chat.ts`
- `src/cli/commands/docs.ts`
- `src/cli/commands/init.ts`
- `src/cli/commands/logs.ts`
- `src/cli/commands/mark-done.ts`
- `src/cli/commands/next-task.ts`
- `src/cli/commands/reset.ts`
- `src/cli/commands/run.ts`
- `src/cli/commands/start.ts`
- `src/cli/commands/status.ts`
- `src/cli/commands/stop.ts`
- `src/cli/commands/task-context.ts`
- `src/cli/index.ts`
- `src/core/backlog-manager.ts`
- `src/core/event-bus.ts`
- `src/core/task-runtime.ts`
- `src/llm/anthropic.ts`
- `src/llm/claude-code.ts`
- `src/llm/provider.ts`
- `src/schemas/agent-frontmatter.ts`
- `src/schemas/backlog.ts`
- `src/schemas/config.ts`
- `src/schemas/events.ts`
- `src/tmux/session-manager.ts`
- `src/types.ts`
- `src/utils/git.ts`
- `src/utils/logger.ts`
- `src/utils/markdown.ts`
- `src/utils/paths.ts`
- `src/utils/vscode-bridge.ts`
- `templates/_base/conventions.md`
- `templates/_base/engineer.md`
- `templates/_base/tools.md`
- `templates/_claude/commands/next.md`
- `templates/_claude/commands/run.md`
- `templates/_codex/architect.md`
- `templates/_copilot/architect.md`
- `templates/architect.md`
- `templates/gitignore.template`
- `templates/welcome-arch-001.md`
- `tsconfig.json`
- `vscode-extension/.vscode/launch.json`
- `vscode-extension/.vscode/tasks.json`
- `vscode-extension/.vscodeignore`
- `vscode-extension/out/agents-provider.js`
- `vscode-extension/out/agents-provider.js.map`
- `vscode-extension/out/backlog-provider.js`
- `vscode-extension/out/backlog-provider.js.map`
- `vscode-extension/out/extension.js`
- `vscode-extension/out/extension.js.map`
- `vscode-extension/package-lock.json`
- `vscode-extension/package.json`
- `vscode-extension/src/agents-provider.ts`
- `vscode-extension/src/backlog-provider.ts`
- `vscode-extension/src/extension.ts`
- `vscode-extension/tsconfig.json`

## Regole operative

Usare staging esplicito per task, includendo la relativa checkbox in tasks.md.
Qualsiasi nuova pulizia estranea ai task richiede autorizzazione specifica.
La rimozione di fixture temporanee richiede verifica preventiva di proprietà e uscita
dei processi controllati; non usare reset/clean per ottenere un working tree pulito.
