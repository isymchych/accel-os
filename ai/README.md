# AI setup

* `openai-codex`


# PRINCIPLES
* pragmatic
* human-in-the-loop
* digital exoskeleton - to amplify user capabilities


# USEFUL PATTERNS / IDEAS
* "distill"/"compress"/"high signal"
* scoring rubrics
* chain-of-thought reasoning
* human-in-the-loop
* Critic(/Verifier) pass
* **build pipelines** even if the end result is an AGENTS.md or SKILL.md - keep "source doc" -> ask agent to build a skill based on it -> improve/compress/"distill"
* (self)-checklists
* error log
* progressive disclosure
* red/green TDD
* Spec-driven development
* AI-first company - markdown spec graph; crypto contracts
* Folding context - is an iterative diverge→converge workflow where you run parallel LLM explorations, compress each into durable notes, then clear and re-inject those summaries to synthesize higher-quality reasoning and decisions.
* refactor: Pilot change + rollout

* Read the code first, then write a repo walkthrough that follows execution order from entry point to outcomes, interleaving detailed explanations with small, exact source excerpts that ground each step.
* setup project constitution (standards, principles) in AGENTS.md - check/use Github speckit
* Keep lots of small proof-of-concept repos (often “just enough code” to demonstrate a technique). With agents that can search and fetch code, you can point them at your own repos/examples (or even have them clone them) and say “build X using patterns from Y,” meaning you only need to figure out a trick once—then reuse it forever.


# USEFUL QUESTIONS
* what are pain points of ...?
* approaches, best practices?
* what is better question
* Explain this change at 3 levels:
    1) High-level intent
    2) Data-flow level
    3) Edge-case reasoning
* Is this idiomatic?
* Is the doc coherent?
* check if we can improve boundaries

# SUBAGENTS
* subagent to run build/tests/lints/typechecks and analyze failures (RCA?) and provide summary back 


# RESEARCH AREAS
* common failure mode: “helpful overreach.”


# Getting started with AI coding agents
* Focus on judgment, critique, and collaboration, not “generate code” first - ask questions
* The key is providing detailed context
* ЛЛМки ліняться, потрібно бути уважним - "збережи ВСЮ інформацію"
* у ЛЛМом буває ще й "лінивий настрій"
* деякі ЛЛМки "тупіють" із часом (місяці); всі ЛЛМки тупіють із заповненням контексту
* ЛЛМки бувають "занадто" розумні - деколи краще брати low модельку для рефакторинга чи дрібних змін, high моделі краще роблять e2e фічі
* ЛЛМка - дебагай падіння github actions
* ad-hoc scripts, skills
* можна задавати питання - How does logging work in this project?" Explain the code
* Planner–Executor Pattern:
  * also Critic: “Review the result and confirm if it meets the plan. If not, explain the discrepancy and propose a fix.”
  * TDD - feedback loop
* iterate, polish - both the plan and the code
* semports - semantic ports
* **Cognitive Debt** - before writing code was slow, now understanding code is slow -> document rationale, comprehension is first-class eng task
* https://addyosmani.com/blog/agentic-engineering/
* https://cursor.com/blog/agent-best-practices
*  > In a system where agent throughput far exceeds human attention, corrections are cheap, and waiting is expensive.
* > Codex replicates patterns that already exist in the repository—even uneven or suboptimal ones -> regular "garbage collection" / code cleanup tasks by codex, based on "golden rules"
* > Our most difficult challenges now center on **designing environments, feedback loops, and control systems** that help agents accomplish our goal: build and maintain complex, reliable software at scale.




## MCPs
* [Chrome dev tools MCP](https://github.com/ChromeDevTools/chrome-devtools-mcp)
* [Serena MCP](https://github.com/oraios/serena) - use LSP servers
* [Playwright MCP](https://github.com/microsoft/playwright-mcp) - browser control & automation
* [Perplexity MCP](https://github.com/perplexityai/modelcontextprotocol) - search & research using Perplexity

## Docs

* [Agent Memory Formulation](docs/agent_memory_formulation.md)
* [Principles](docs/principles.md)
* [Root Cause Analysis](docs/root_cause_analysis.md)

* [Architecture Guidelines](docs/architecture_guidelines.md)
* [Code Cleanup Guidelines](docs/code_cleanup_guidelines.md)
* [Code Review Guidelines](docs/code_review_guidelines.md)
* [Coding Style Guidelines](docs/coding_style_guidelines.md)
* [Coding Workflow Principles](docs/coding_workflow_principles.md)

* [Git SPR](docs/git-spr.md)
* [OpenAI Prompt Guidelines](docs/openai_prompt_guidelines.md)
* [Plan Mode Requirements](docs/plan_mode_requirements.md)
* [Plan Mode Best Practices](docs/plan_mode_best_practices.md)
* [Plan Mode Spec](docs/plan_mode_spec.md)
* [Explore Mode Spec](docs/explore_mode_spec.md)