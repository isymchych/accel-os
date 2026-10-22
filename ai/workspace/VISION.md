# AI workspace vision

Draft vision. The product direction and MVP decisions below are agreed; later capabilities remain
future scope.

## Purpose

A personal control center for independently running agents and their workflows. Users choose what
runs, where, and when, and coordinate overlapping work themselves. Execution stays observable,
controllable, and recoverable across client disconnections.

Interactive coding begins a broader set of agent workflows. Conversations provide one interface to
agent work. Favor clear ownership, useful types, low cognitive load, and long-term maintainability
for humans and coding agents.

## Initial scope

The first usable version is local interactive coding with durable execution:

- Choose a working directory, directly or through an optional saved project.
- Create or reopen a conversation; submit input and stream responses and tool activity.
- Send explicit follow-up input while busy.
- See running, waiting, and blocked work in a work view.
- Read and edit files and run commands under the execution policy below.
- Stop work, reconnect to ongoing work, and recover eligible pending work after a server restart.
- Reuse the existing `ai/` provider, model, account, and server-side credential mechanisms.

Prioritize the work view over presets or extensive settings.

## Agreed MVP decisions

1. **Scope:** start with the [initial interactions](#initial-scope). Project deletion, reassignment,
   and additional interactions require an explicit scope decision. Before adding deletion or
   reassignment, define how existing conversation references stay valid.
2. **Execution authority:** agents may read and edit host files and execute shell commands without
   approvals. They run directly on the host, unsandboxed, with the host process's permissions. The
   user-provided working directory is a starting context, not a filesystem boundary; localhost
   provides no isolation.
3. **Credentials:** the existing `ai/` mechanisms own authentication and credential management for
   the workspace. A browser account-switching or credential-management interface is optional.

Later scope: presets, steering, remote access, orchestration, multi-user hosting, plugin loading,
embedded terminals, and a separate memory system. Codemode, MCP, skills, prompt templates, custom Pi
extensions, and richer session interactions are optional for the first version; reuse supported
capabilities when they directly serve the initial scope.

## Longer-term direction

Start locally, with a path to multiple hosts and web, mobile, and terminal clients. Registered hosts
form a constellation showing hosts, agents, conversations, and runs, including independently started
hosts joined from another workspace instance.

Support workflows beyond interactive coding and execution in local or remote environments. Autonomy,
membership, synchronization, provisioning, and networking policies await future decisions.
[ARCHITECTURE.md](ARCHITECTURE.md#future-host-and-environment-constraints) preserves the technical
constraints for that direction; [DOMAIN.md](DOMAIN.md) defines behavioral rules.