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
- Fork from conversation history and navigate history and branches through a tree.
- Send explicit follow-up input while busy.
- See running, waiting, and blocked activity through conversation-list status indicators.
- Read and edit files and run commands under the execution policy below.
- Stop active work.
- Reconnect to ongoing work and automatically recover eligible unfinished work after a server
  restart.
- Log in to multiple OpenAI accounts and use different accounts in concurrent conversations.

Conversation-list status indicators suffice for MVP; there is no separate work-view screen.

## Agreed MVP decisions

1. **Scope:** start with the [initial interactions](#initial-scope). Project deletion, reassignment,
   and additional interactions require an explicit scope decision. Before adding deletion or
   reassignment, define how existing conversation references stay valid.
2. **Execution authority:** agents may read and edit host files and execute shell commands without
   approvals. They run directly on the host, unsandboxed, with the host process's permissions. The
   user-provided working directory is a starting context, not a filesystem boundary; localhost
   provides no isolation.
3. **Configuration and credentials:** the workspace owns model choices, account selection, and
   credential configuration. MVP supports OpenAI login with multiple accounts, selected per
   conversation and usable concurrently. Credentials and refresh state stay isolated per account and
   server-side. Switching an existing conversation's account is post-MVP; a browser
   credential-management interface is optional.
4. **Stop and recovery:** Stop cancels active execution and terminates its owned processes.
   Queued-input behavior follows the selected runtime; queue preservation and explicit resumption
   are not MVP requirements. Automatic recovery follows upstream tool replay policies, with
   interrupted calls visible and agent inspection before retrying uncertain effects. Recovery
   requires neither a dedicated dashboard nor blanket human approval. See the
   [domain lifecycle](DOMAIN.md#work-lifecycle).
5. **Branching:** include forking and tree-based history and branch navigation, in the spirit of
   Pi's coding agent. Side-by-side branch comparison is post-MVP. The detailed interaction design
   remains open.

Later scope: presets (including storage and UI), account switching within an existing conversation,
side-by-side branch comparison, other providers and custom endpoints, steering, remote access,
orchestration, multi-user hosting, plugin loading, embedded terminals, and a separate memory system.
Codemode, MCP, skills, prompt templates, custom runtime extensions, and richer session interactions
are optional for the first version; reuse supported capabilities when they directly serve the
initial scope.

## Longer-term direction

Start locally, with a path to multiple hosts and web, mobile, and terminal clients. Registered hosts
form a constellation showing hosts, agents, conversations, and runs, including independently started
hosts joined from another workspace instance.

Support workflows beyond interactive coding and execution in local or remote environments. Autonomy,
membership, synchronization, provisioning, and networking policies await future decisions.
[ARCHITECTURE.md](ARCHITECTURE.md#future-host-and-environment-constraints) preserves the technical
constraints for that direction; [DOMAIN.md](DOMAIN.md) defines behavioral rules.