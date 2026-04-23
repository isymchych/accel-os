import assert from "node:assert/strict";
import test from "node:test";

import {
  buildFdPattern,
  extractAtFileToken,
  formatAutocompleteItems,
  planFdQuery,
  rankCandidates,
  shouldIncludeHidden,
  type CandidateEntry,
} from "./fuzzy-at-file-autocomplete.ts";

test("extractAtFileToken handles plain and quoted @ paths", () => {
  assert.equal(extractAtFileToken("open @rea"), "@rea");
  assert.equal(extractAtFileToken('@"my fold'), '@"my fold');
  assert.equal(extractAtFileToken("not-an-email@example.com"), null);
});

test("planFdQuery scopes search roots and hidden-file policy by active segment", () => {
  const scoped = planFdQuery("/repo", "foo/bar");
  assert.equal(scoped.searchRoot, "/repo");
  assert.equal(scoped.displayPrefix, "");
  assert.equal(scoped.fuzzyQuery, "foo/bar");
  assert.equal(scoped.includeHidden, false);

  const hiddenScoped = planFdQuery("/repo", "foo/.g");
  assert.equal(hiddenScoped.searchRoot, "/repo");
  assert.equal(hiddenScoped.displayPrefix, "");
  assert.equal(hiddenScoped.fuzzyQuery, "foo/.g");
  assert.equal(hiddenScoped.includeHidden, true);
});

test("planFdQuery scopes only when the directory prefix exists", () => {
  const scoped = planFdQuery(process.cwd(), "lib/fuzzy");
  assert.equal(scoped.searchRoot, `${process.cwd()}/lib`);
  assert.equal(scoped.displayPrefix, "lib/");
  assert.equal(scoped.fuzzyQuery, "fuzzy");
  assert.equal(scoped.includeHidden, false);

  const deepFuzzy = planFdQuery(process.cwd(), "tui/src/auto");
  assert.equal(deepFuzzy.searchRoot, process.cwd());
  assert.equal(deepFuzzy.displayPrefix, "");
  assert.equal(deepFuzzy.fuzzyQuery, "tui/src/auto");
  assert.equal(deepFuzzy.includeHidden, false);
});

test("shouldIncludeHidden only enables hidden entries for dot-prefixed active segments", () => {
  assert.equal(shouldIncludeHidden(".pi"), true);
  assert.equal(shouldIncludeHidden("foo/.config"), true);
  assert.equal(shouldIncludeHidden("foo/bar"), false);
});

test("buildFdPattern creates a subsequence regex", () => {
  assert.equal(buildFdPattern("abc"), "a.*b.*c");
  assert.equal(buildFdPattern(""), ".");
});

test("rankCandidates prefers directories and stronger basename matches", () => {
  const entries: CandidateEntry[] = [
    { path: "src.txt", isDirectory: false },
    { path: "src", isDirectory: true },
    { path: "lib/describe.ts", isDirectory: false },
  ];

  assert.deepEqual(rankCandidates(entries, "src"), [
    { path: "src", isDirectory: true },
    { path: "src.txt", isDirectory: false },
  ]);
});

test("rankCandidates prefers basename hits over parent-directory hits", () => {
  const entries: CandidateEntry[] = [
    { path: "packages/plan/docs/readme.md", isDirectory: false },
    { path: "docs/plan.md", isDirectory: false },
    { path: "src/explain.ts", isDirectory: false },
  ];

  assert.deepEqual(rankCandidates(entries, "plan").slice(0, 2), [
    { path: "docs/plan.md", isDirectory: false },
    { path: "packages/plan/docs/readme.md", isDirectory: false },
  ]);
});

test("rankCandidates prefers basename prefixes over non-basename segment prefixes", () => {
  const entries: CandidateEntry[] = [
    { path: "packages/tui/src/autocomplete.ts", isDirectory: false },
    { path: "packages/autocomplete/src/other.ts", isDirectory: false },
    { path: "packages/tui/src/manual.ts", isDirectory: false },
  ];

  assert.deepEqual(rankCandidates(entries, "auto"), [
    { path: "packages/tui/src/autocomplete.ts", isDirectory: false },
    { path: "packages/autocomplete/src/other.ts", isDirectory: false },
  ]);
});

test("rankCandidates prefers segment-boundary contiguous matches", () => {
  const entries: CandidateEntry[] = [
    { path: "src/components/Button.tsx", isDirectory: false },
    { path: "src/xcomponent/Button.tsx", isDirectory: false },
  ];

  assert.deepEqual(rankCandidates(entries, "comp"), [
    { path: "src/components/Button.tsx", isDirectory: false },
    { path: "src/xcomponent/Button.tsx", isDirectory: false },
  ]);
});

test("formatAutocompleteItems preserves quoting and directory suffixes", () => {
  const items = formatAutocompleteItems(
    [
      { path: "my folder", isDirectory: true },
      { path: "my folder/test.txt", isDirectory: false },
    ],
    { displayPrefix: "", quoted: true },
  );

  assert.deepEqual(items, [
    {
      value: '@"my folder/"',
      label: "my folder/",
      description: "my folder",
    },
    {
      value: '@"my folder/test.txt"',
      label: "test.txt",
      description: "my folder/test.txt",
    },
  ]);
});
