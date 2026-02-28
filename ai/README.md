# AI setup

* `openai-codex`


# PRINCIPLES
* pragmatic
* human-in-the-loop
* digital exoskeleton


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


# RESEARCH AREAS
* common failure mode: “helpful overreach.”


## MCPs

* [Serena MCP](https://github.com/oraios/serena) - use LSP servers
* [Playwright MCP](https://github.com/microsoft/playwright-mcp) - browser control & automation
* [Perplexity MCP](https://github.com/perplexityai/modelcontextprotocol) - search & research using Perplexity

## Docs

* [Agent Memory Formulation](docs/agent_memory_formulation.md)
* [Root Cause Analysis](docs/root_cause_analysis.md)

* [Architecture Guidelines](docs/architecture_guidelines.md)
* [Code Review Guidelines](docs/code_review_guidelines.md)
* [Coding Style Guidelines](docs/coding_style_guidelines.md)

* [Plan Mode Best Practices](docs/plan_mode_best_practices.md)
* [Plan Mode Spec](docs/plan_mode_spec.md)
* [Explore Mode Spec](docs/explore_mode_spec.md)