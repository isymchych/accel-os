* First critique code
* Then run cleanup
* then run follow-up check
* and run one more "finishing" cleanup if necessary

# Code cleanup should
* fix violations of coding guidelines (both personal & project)
* turn methods into module functions if they don't use `this`
* replace type-level indirection that reduces readability - i.e. indexed types, utility extraction
* use branded types
* prefer pure collection helpers that return values over mutating output accumulators; allow mutable sinks only for API/streaming/perf constraints and make mutation explicit
* consider inlining private functions/methods that are called only once
* consider removing shallow pass-through helpers that add no domain meanining. Keep a helper only when it centralizes reusable policy, reduces duplication materially, or provides a stable semantic boundary.
* consider turning function/method object param into separate args
* dead abstractions