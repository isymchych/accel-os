## TODO

- rename "runtime" to something more interesting - i.e. "robot"/"agent"?
- review the ARCHITECTURE - cleanup, drop unreasonable/stupid/LLM-generated requirements
- company? - agentic system/organisation
- separating where the work executes from where the developer controls it
- the UI, agent execution engine, and synchronization layer are separate systems

> The interesting abstraction is:

> Agent = execution backend

> Session = durable conversation and command state

> Workspace = device + project folder

> UI = replaceable control surface

> Sync = optional coordination between machines

---

- personal playground
- The Place - for intrecating with agents. it should feel like that, not like regular "chat app"
  - better operating environment for agents
- sandboxing? microvm? devcontainer? code-first? only allow codemode?
- memory system / compound engineering
- live system introspection / repl
  - do we even need it? chat is repl, expose introspection tools there
  - like lisp machine / emacs /
  - find out best ideas/practices;
  - runtime inspection like deepseek harness; browser control
- ! infrastructure for long-running tasks, secure permissions, and state persistence
- more things ephemeral? projects/runners
- connect/control other machines - ssh?
- project vs one-off tasks

## Features

- diffs, file browser
- bookmark some sessions; preview sessions
- easy context forking
- voice input
- timeline for branches
- Split thoughts/tools usage/responses in separate views
- tasks/projects/kanban board?
- automations: scheduled tasks, notifications
- code review tool - important changes, guided explanations, ai code review comments - for local
  changes & external PRs
- search in session, in all sessions
- terminal

## UI

- UI theme - retrofuturism, cyberpunk, minimal
- minimalist, clean, concise, humane interface like AMP
- animated agent image - abstract shapes, structures, circle, lines and angles, dynamically
  changing, dark gold, sun; depends on model / thinking level; avoid anthropomorphisation

## Other

- web workspace for agents
  - agent types - "specialists" - with custom prompts/tools/environment, optimized for certain tasks
  - orchestrator - picks teams of agents for tasks (or builds them)
  - https://blog.mempko.com/the-planning-dilemma-in-ai-coding-superpowers-vs-abject/
  - https://paseo.sh
  - https://github.com/hyperpuncher/pi-ui
  - https://github.com/mattiacerutti/supernova
  - https://t3.codes/
  - https://github.com/backnotprop/plannotator
  - https://github.com/disler/durable-pi
  - https://github.com/zeronsh/zeron
  - AMP web
  - sandbox/vm/microvm/isolation; new agent -> fresh env? how to access it i.e. from my emacs? how
    to work on the same feature from multiple sessions/threads?
  - plugins/extensions - like deepseek agent cordis; investigate pi-durable plugins/extensions first
  - pi-durable-based executors / AMP orbs
  - memory system
  - ? https://github.com/ghuntley/overalls
  - agents should be WELL INTEGRATED INTO THEIR ENVIRONMENT
- dynamic system prompts (pi can't do that)
- live editing/live reload, even in "prod mode" (do we need "prod mode"?); live reload (of plugins,
  of web interface) shoudn't break app (easily reversible)
- maybe through mcp?

## Ideas

- approve read/write access outside the workspace - show confirmation dialog
  - with security/privacy risk review by other agent? (so agent will read the file anyway?)
  - with ability to easily preview the file myself
- being able to iterate on a document(s) in chat - deltas should be saved right in conversation?
  where to save / export them? keep also decisions / plans in conversation?

> another important thing brain dump: my vision is that agents (pi-durable) should be distributed -
> they could be executed (operate) on multiple servers/devices/environments (browsers, mobile, edge
> computing, iot), and the workspace is just a place to connect, coordinate & manage them. - need to
> think it through - how autonomous they should be? "hands" or "brain+hands"? looks like at least 2
> problems here: workspace/agent starts "executor" agents, and human opens another workspace
> instance with local executor agent - all should be visible in the workspace "constellation" page
> only "local" agents from the start, later maybe use iroh for networking later as a use case - in
> future i might want to "run" an agent on the other my machine to do some tasks there (i.e. some
> maintenance?) but a usual flow would be to spin up lightweight remote env + agent in a cloud to do
> the job and suspend so UI client should be disconnected from execution; in the future i might run
> i.e. mobile ui and web ui and i'd like to see the same info (agents, executions, sessions etc.).
> Such client-server architecture is out of scope for now, but we should take this direction into
> account. inspiration: something like "orbs" in AMP https://github.com/disler/durable-pi

## Maybe later

- telemetry - opentelemetry / langfuse / phoenix
- UI components for agents to show UI, like https://github.com/thesysdev/openui

## Inspiration

- <https://github.com/githubnext/chopin>