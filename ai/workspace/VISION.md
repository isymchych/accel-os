# AI workspace vision

Status: draft. Product direction agreed; initial scope and deferrals remain proposals where marked.

## Purpose

Build a lightweight workspace for observing, coordinating, and managing independently running AI
agents. Start with local interactive coding and preserve a path to multiple agent hosts and web,
mobile, and terminal clients. Optimize for explicit ownership, useful types, low cognitive load, and
long-term maintainability by humans and coding agents.

## Initial scope

Agreed target: basic interactive coding with durable execution.

Proposed first product slice, pending confirmation:

- Register and select a local project; create or reopen a conversation.
- Submit input and observe streamed responses and tool activity.
- Read and edit files and run commands under the agreed execution policy.
- Stop work, reconnect to ongoing work, and recover eligible pending work after a server restart.
- Use an initial provider/model with server-side credentials.

Proposed deferrals, pending confirmation: codemode, MCP, skills, prompt templates, custom Pi
extensions, and richer session interactions. Reuse runtime and library capabilities as these enter
scope.

Presets and other capabilities outside the first slice describe longer-term direction.

Remote access, agent orchestration, multi-user hosting, plugin loading, embedded terminals, and a
separate memory system remain future scope.

## Longer-term direction

Start with workspace services and one local agent host colocated in a single Node process.

Future deployments connect registered hosts into a constellation, with shared views across clients.
A host may run tools in its own environment or use a remote execution environment. Provisioning a
new host and joining an existing host are distinct ways to establish membership.

The future constellation page shows registered hosts and their agents, conversations, and runs,
including hosts started independently and joined from another workspace instance.

Cloud provisioning, suspension, and wake-up belong to environment lifecycle management.

Autonomy policy, constellation membership and synchronization, remote provisioning, and networking
remain design decisions for future slices. Iroh is a candidate transport. Browser, mobile, edge, and
IoT execution hosts require platform-specific runtime and storage assessment.

## Product decisions before the first slice

Resolve these before implementing real user interactions and tool execution; harmless integration
checks can proceed independently:

1. **Initial scope:** confirm the proposed [MVP interactions](#initial-scope) and integration
   deferrals. Additional interactions, including project deletion and reassignment, stay deferred
   unless explicitly added. If they are added, define how existing conversation references remain
   valid before implementing them.
2. **Execution authority:** decide whether agents may edit host files and execute shell commands.
   Approvals remain explicitly undecided: are they needed, for which actions, and with what scope
   and rejection/disconnect/restart behavior? Select no approval mechanism until those requirements
   are agreed. If execution must be confined rather than merely rooted in a working directory,
   define the isolation boundary before enabling those tools. Localhost deployment does not grant
   tool permissions or provide isolation.
3. **Credentials:** choose the initial provider/model and server-side credential flow. Reusing an
   existing CLI account needs a verified token-refresh ownership strategy; account switching and
   browser-based credential management are not implicitly required.

Engineering questions are covered by the [integration checks](ARCHITECTURE.md#integration-checks);
they are not additional product decisions. Do not reopen the agreed localhost deployment and
separated-source direction without new requirements or a concrete blocker.