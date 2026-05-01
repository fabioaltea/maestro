---
description: Execute a Maestro task by its id (e.g. /run ARCH-001 or /run ENG-007)
---

Read the execution context for `$ARGUMENTS` by running `Bash: maestro task-context $ARGUMENTS`.

Then execute the task exactly as the returned protocol instructs:
- For Architect phases (ARCH-NNN), run the conversational/autonomous flow described in the context, write the required artifacts, and pause at the phase gate to ask the user "approve" or "revise <feedback>" before completing.
- For Engineer tasks (ENG-NNN), implement the task using your native tools (Read, Write, Edit, Bash, Glob, Grep), run tests where applicable, then verify the acceptance criteria.

When the user has approved (gated phases) or all acceptance criteria are met, run `Bash: maestro mark-done $ARGUMENTS`. The next task (if any) will be auto-triggered by the Maestro VSCode extension — you can stop after `mark-done` returns.
