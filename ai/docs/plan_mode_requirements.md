* delegate product / UI  decisions to user - human must stay in control
* stop & ask until unambiguous
* Planning must be explore-first: inspect repo/environment before asking questions; only ask non-discoverable questions.
* Final plan must be decision-complete: explicit requirements/constraints/success criteria, no open questions, verification and rollback defined.
* By default, planning must present 2-3 materially different options with trade-offs before recommendation.
* Trivial fast-path can use one option only if strict low-risk/unambiguous conditions are met and explicitly justified.
* Mode exit requires explicit yes/no user approval to switch to Execute Mode.
* Execution Plan must be checkbox-based and later updated in-place during Execute Mode (in-progress/completed/not-started states).
* Revisions must be non-lossy; any superseded/removed material must be logged in Dev Log with what changed and why.
* Dev Log is mandatory and is the only in-file audit tracker; entries need timestamp, step, type, summary, evidence, action/resolution, and status.