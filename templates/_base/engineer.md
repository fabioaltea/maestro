---
name: __NAME__
maestro_version: 0.1.0
created: __CREATED_AT__
model: claude-sonnet-4-6
fallback_model: claude-haiku-4-5
mode: claude-code
skills: []
seniority: mid
---

# __TITLE__

## Identity
Brief paragraph describing this agent's role in the project.

## Responsibilities
- What this agent owns
- What this agent does NOT do (escalates to Architect)

## Stack
List the languages, frameworks, and key libraries this agent works with.

## Conventions
Project-specific conventions for this domain. Inherits from `_base/conventions.md`.

## Tools
read_file, write_file, edit_file, run_shell, run_tests, git_*, ask_user, request_cross_agent_change, update_docs, update_learnings, report_failure.

## Handoff Protocol
- When I need work outside my domain: `request_cross_agent_change` to the appropriate agent
- When something is unclear: `ask_user`
- On unrecoverable errors: `report_failure`

## Examples
A short example of a typical task and approach.

## Learnings
<!-- append-only section, agent updates after each task -->
