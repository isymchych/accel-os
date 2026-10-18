# Sources and Adaptation

This skill is a lightweight synthesis for small and medium projects, not a claim of conformance to
an external development or knowledge standard. The linked sources are background material; this
skill's instructions govern the adaptation.

## Spec-Driven Development

Source: Addy Osmani's
[spec-driven-development skill](https://github.com/addyosmani/agent-skills/blob/main/skills/spec-driven-development/SKILL.md).

Borrow requirements clarification, visible assumptions, observable success criteria, and maintaining
the contract as agreed scope evolves. Do not import mandatory separate-turn approvals,
time/file-count thresholds, task-directory conventions, or a spec for every change. Repository-wide
commands, style, and agent permissions stay in their existing authoritative guidance.

## Open Knowledge Format

Source: GoogleCloudPlatform's
[Open Knowledge Format specification](https://github.com/GoogleCloudPlatform/open-knowledge-format/blob/main/SPEC.md).

Borrow human-readable Markdown, discoverable entry points, explicit lifecycle, and links to
evidence. This skill does not implement OKF: it does not require its frontmatter schema, trust
levels, provenance graph, or attestations. Review, acceptance, implementation, and verification
remain distinct claims.

## Write Great Code, Volume 3: Engineering Software

Source: Randall Hyde; [publisher overview](https://nostarch.com/greatcode3).

The publisher identifies traceability and software documentation as topics. Use lightweight links
between requirements, reasoning, and verification to support consistency. This adaptation is
informed by the publisher overview, not a full reading of the book; do not attribute specific
templates or detailed rules to Hyde without checking the relevant text.

## Architecture Decisions

Source: Michael Nygard,
[Documenting Architecture Decisions](https://www.cognitect.com/blog/2011/11/15/documenting-architecture-decisions).

Borrow concise records of significant choices, context, status, and consequences, and preservation
of superseded decisions. The three-part threshold for creating an ADR comes from this repository's
domain-modeling skill, not a claimed requirement of Nygard's format.

## Architecture Views

Sources: [C4 model](https://c4model.com/) and
[arc42 template overview](https://arc42.org/overview/).

Borrow useful abstraction levels and prompts for context, constraints, responsibilities, runtime
scenarios, quality requirements, and risks. Select what explains the actual system; do not require
every view or section. These frameworks guide documentation, not a mandatory implementation
architecture.