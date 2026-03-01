* red/green TDD
* Add tests when you introduce a new reusable boundary that transforms or interprets data, especially if multiple call sites depend on it.
  Heuristic:
  1. New abstraction + behavior branching (null/throw, fallback logic) => test it.
  2. Data shape conversion (DB/API/domain mapping) => test it.
  3. Fan-out to multiple consumers => test once at the boundary to prevent broad regressions.
  4. Fixing a contract bug => add a regression test at the layer now enforcing that contract.
  Short version: if a new method becomes a trust point, it needs a test.