import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import type { SpawnSyncReturns } from "node:child_process";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SCRIPT = fileURLToPath(new URL("./mb-merge-csvs.ts", import.meta.url));

type Fixture = {
  root: string;
  read(name?: string): Promise<string>;
  run(args?: string[]): SpawnSyncReturns<string>;
};

async function fixture(t: test.TestContext, files: Record<string, string>): Promise<Fixture> {
  const root = await mkdtemp(path.join(tmpdir(), "mb-merge-csvs-test-"));
  t.after(async () => rm(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries(files)) {
    await writeFile(path.join(root, name), content);
  }
  return {
    root,
    read: (name = "combined.csv"): Promise<string> => readFile(path.join(root, name), "utf8"),
    run: (args = ["-o", "combined.csv"]): SpawnSyncReturns<string> =>
      spawnSync(process.execPath, [SCRIPT, ...args], {
        cwd: root,
        encoding: "utf8",
        timeout: 5000,
      }),
  };
}

test("merges browser downloads naturally, preserving semicolons, BOM, and field values", async (t) => {
  const inputs = {
    "goods (10).csv": '\uFEFFid;name\r\n10;"two ""quotes"""\r\n',
    "goods (2).csv": '\uFEFFid;name\r\n2;"two\nlines"\r\n',
    "goods.csv": '\uFEFFid;name\r\n0;"comma, and ; semicolon"\r\n',
    "goods (1).csv": "\uFEFFid;name\r\n1;00123\r\n",
  };
  const f = await fixture(t, inputs);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    await f.read(),
    '\uFEFFid;name\n0;"comma, and ; semicolon"\n1;00123\n2;"two\nlines"\n10;"two ""quotes"""\n',
  );
  assert.match(result.stdout, /4 files, 4 data rows/u);
  assert.doesNotMatch(result.stdout + result.stderr, /00123|two|semicolon/u);
  for (const [name, content] of Object.entries(inputs)) assert.equal(await f.read(name), content);
});

test("detects comma and tab formats, with ordinary natural numbering", async (t) => {
  for (const delimiter of [",", "\t"]) {
    const f = await fixture(t, {
      "page10.csv": `id${delimiter}name\n10${delimiter}ten\n`,
      "page2.csv": `id${delimiter}name\n2${delimiter}two\n`,
    });
    const result = f.run();
    assert.equal(result.status, 0, result.stderr);
    assert.equal(await f.read(), `id${delimiter}name\n2${delimiter}two\n10${delimiter}ten\n`);
  }
});

test("dry-run lists order without reading or validating file contents", async (t) => {
  const f = await fixture(t, { "page10.csv": '"invalid', "page2.csv": "" });
  const result = f.run(["--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(
    result.stdout
      .trim()
      .split("\n")
      .map((name) => path.basename(name)),
    ["page2.csv", "page10.csv"],
  );
  assert.deepEqual((await readdir(f.root)).sort(), ["page10.csv", "page2.csv"]);
});

test("quoted glob filters inputs and duplicate arguments do not duplicate data", async (t) => {
  const f = await fixture(t, {
    "goods.csv": "id,name\n1,one\n",
    "unrelated.csv": "different,header\n2,two\n",
  });
  const result = f.run(["-o", "combined.csv", "goods*.csv", "goods.csv"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await f.read(), "id,name\n1,one\n");
});

test("ambiguous detection requires an override, which preserves comma-containing fields", async (t) => {
  const f = await fixture(t, { "goods.csv": "a,b;c\n1,2;3\n" });
  const failed = f.run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /ambiguous delimiter/u);
  await assert.rejects(f.read(), { code: "ENOENT" });
  const result = f.run(["-o", "combined.csv", "--delimiter", ";"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await f.read(), "a,b;c\n1,2;3\n");
});

test("tab override allows single-column input", async (t) => {
  const f = await fixture(t, { "goods.csv": "name\none\n" });
  const result = f.run(["-o", "combined.csv", "--delimiter", "tab"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await f.read(), "name\none\n");
});

test("conflicting formats, headers, empty input, and malformed records leave no output or temp files", async (t) => {
  for (const [second, message] of [
    ["id;name\n2;two\n", /Conflicting delimiter/u],
    ["id,other\n2,two\n", /Header mismatch/u],
    ["", /no consistent delimiter/u],
    ['id,name\n2,"PRIVATE"bad\n', /no consistent delimiter/u],
    ["id,name\n2,two,extra\n", /no consistent delimiter/u],
  ] as const) {
    const f = await fixture(t, { "goods.csv": "id,name\n1,one\n", "goods (1).csv": second });
    const result = f.run();
    assert.equal(result.status, 1);
    assert.match(result.stderr, message);
    assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/u);
    assert.deepEqual((await readdir(f.root)).sort(), ["goods (1).csv", "goods.csv"]);
  }
});

test("explicit delimiter reports malformed record location without revealing private values", async (t) => {
  const f = await fixture(t, { "goods.csv": 'id,name\n1,"PRIVATE"bad\n' });
  const result = f.run(["-o", "combined.csv", "--delimiter", ","]);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /goods.csv: CSV_INVALID_CLOSING_QUOTE at line 2, record 2/u);
  assert.doesNotMatch(result.stdout + result.stderr, /PRIVATE/u);
  await assert.rejects(f.read(), { code: "ENOENT" });
});

test("existing output is excluded and never overwritten", async (t) => {
  const f = await fixture(t, { "goods.csv": "id,name\n1,one\n", "combined.csv": "original" });
  const result = f.run();
  assert.equal(result.status, 1);
  assert.equal(await f.read(), "original");
  assert.deepEqual((await readdir(f.root)).sort(), ["combined.csv", "goods.csv"]);
});

test("help and invalid invocations", async (t) => {
  const f = await fixture(t, {});
  assert.equal(f.run(["--help"]).status, 0);
  for (const args of [
    [],
    ["-o", "combined.csv"],
    ["--dry-run", "missing*.csv"],
    ["--delimiter", "xx", "--dry-run"],
  ]) {
    assert.equal(f.run(args).status, 1, JSON.stringify(args));
  }
});
