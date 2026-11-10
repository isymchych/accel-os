import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test, { type TestContext } from "node:test";

import type { ReadToolDetails } from "@earendil-works/pi-coding-agent";

import { executeReadTool, type BuiltInRead } from "./execute.ts";

async function createTempWorkspace(t: TestContext): Promise<string> {
  const cwd = await mkdtemp(join(tmpdir(), "pi-read-tool-"));
  t.after(async () => rm(cwd, { recursive: true, force: true }));
  return cwd;
}

async function writeWorkspaceFile(
  cwd: string,
  relativePath: string,
  content: string,
): Promise<void> {
  const absolutePath = join(cwd, relativePath);
  await mkdir(dirname(absolutePath), { recursive: true });
  await writeFile(absolutePath, content, "utf-8");
}

function createBuiltInRead(cwd: string): BuiltInRead {
  return async (target) => {
    const content = await readFile(resolve(cwd, target.path), "utf-8");
    const lines = content.split("\n");
    const start = target.offset === undefined ? 0 : target.offset - 1;
    if (start >= lines.length) {
      throw new Error(
        `Offset ${target.offset} is beyond end of file (${lines.length} lines total)`,
      );
    }
    const end =
      target.limit === undefined ? lines.length : Math.min(start + target.limit, lines.length);
    const details: ReadToolDetails | undefined = undefined;
    return {
      content: [{ type: "text", text: lines.slice(start, end).join("\n") }],
      details,
    };
  };
}

function textOutput(result: Awaited<ReturnType<typeof executeReadTool>>): string {
  return result.content
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

test("reads multiple files in target order", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "a.txt", "alpha");
  await writeWorkspaceFile(cwd, "nested/b.txt", "beta");

  const result = await executeReadTool(
    { targets: [{ path: "a.txt" }, { path: "nested/b.txt" }] },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );

  assert.equal(textOutput(result), "==> a.txt <==\nalpha\n\n==> nested/b.txt <==\nbeta");
  assert.deepEqual(
    result.details.targets.map(({ path, kind }) => ({ path, kind })),
    [
      { path: "a.txt", kind: "file" },
      { path: "nested/b.txt", kind: "file" },
    ],
  );

  const largeLines = Array.from({ length: 1500 }, (_, index) => `line-${index + 1}`).join("\n");
  await writeWorkspaceFile(cwd, "large-a.txt", largeLines);
  await writeWorkspaceFile(cwd, "large-b.txt", largeLines);
  const fairResult = await executeReadTool(
    { targets: [{ path: "large-a.txt" }, { path: "large-b.txt" }] },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );
  const fairOutput = textOutput(fairResult);

  assert.match(fairOutput, /[=][=]> large-a\.txt <==\nline-1/u);
  assert.match(fairOutput, /[=][=]> large-b\.txt <==\nline-1/u);
  assert.equal(fairResult.details.targets[0]?.truncated, true);
  assert.equal(fairResult.details.targets[1]?.truncated, true);
  assert.ok(fairOutput.split("\n").length <= 2000);
  assert.ok(Buffer.byteLength(fairOutput, "utf-8") <= 50 * 1024);
});

test("lists directory entries with details without recursing by default", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src/index.ts", "export {};\n");
  await writeWorkspaceFile(cwd, "src/lib/helper.ts", "helper\n");
  await symlink("index.ts", join(cwd, "src/current.ts"));

  const result = await executeReadTool(
    { targets: [{ path: "src" }] },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );
  const output = textOutput(result);

  assert.match(output, /^==> src <==/u);
  assert.match(output, /symlink\s+-\s+current\.ts -> index\.ts/u);
  assert.match(output, /file\s+\d+B\s+index\.ts/u);
  assert.match(output, /directory\s+-\s+lib\//u);
  assert.doesNotMatch(output, /lib\/helper\.ts/u);
  assert.equal(result.details.targets[0]?.entryCount, 3);
});

test("recursively lists directories up to max_depth", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "src/lib/deep/helper.ts", "helper\n");

  const shallow = await executeReadTool(
    { targets: [{ path: "src" }], recursive: true, max_depth: 2 },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );
  assert.match(textOutput(shallow), /lib\/deep\//u);
  assert.doesNotMatch(textOutput(shallow), /helper\.ts/u);

  const deep = await executeReadTool(
    { targets: [{ path: "src" }], recursive: true, max_depth: 3 },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );
  assert.match(textOutput(deep), /lib\/deep\/helper\.ts/u);
});

test("numbers selected file lines and preserves absolute line numbers", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta\n\ndelta\nepsilon");

  const result = await executeReadTool(
    {
      targets: [{ path: "note.txt", offset: 2, limit: 3 }],
      show_line_numbers: true,
    },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );

  assert.equal(
    textOutput(result),
    "==> note.txt <==\n2\tbeta\n3\t\n4\tdelta\n\n[More lines in file. Use offset=5 to continue.]",
  );
  assert.equal(result.details.targets[0]?.lineCount, 3);
});

test("does not invent a numbered line for an empty file", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "empty.txt", "");

  const result = await executeReadTool(
    { targets: [{ path: "empty.txt" }], show_line_numbers: true },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );

  assert.equal(textOutput(result), "==> empty.txt <==\n");
});

test("numbered reads preserve exact output-budget continuation offsets", async (t) => {
  const cwd = await createTempWorkspace(t);
  const lines = Array.from({ length: 2020 }, (_, index) => `line-${index + 1}`).join("\n");
  await writeWorkspaceFile(cwd, "large.txt", lines);

  const result = await executeReadTool(
    { targets: [{ path: "large.txt", offset: 11 }], show_line_numbers: true },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );
  const output = textOutput(result);

  assert.match(output, /^\s*==> large\.txt <==/u);
  assert.match(output, /^2007\tline-2007/mu);
  assert.match(output, /Use offset=2008 to continue\./u);
  assert.equal(output.split("\n").length, 2000);
  assert.equal(result.details.targets[0]?.lineCount, 1997);
  assert.equal(result.details.targets[0].truncated, true);
});

test("numbered text reads do not invoke the built-in reader", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "note.txt", "alpha\nbeta");
  let builtInCalls = 0;
  const builtInRead: BuiltInRead = async () => {
    builtInCalls += 1;
    throw new Error("built-in reader should not be called for numbered text");
  };

  const result = await executeReadTool(
    { targets: [{ path: "note.txt" }], show_line_numbers: true },
    cwd,
    undefined,
    builtInRead,
  );

  assert.equal(textOutput(result), "==> note.txt <==\n1\talpha\n2\tbeta");
  assert.equal(builtInCalls, 0);
});

test("numbered reads report a first line that exceeds the byte limit", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "huge's.txt", `small\n${"x".repeat(60 * 1024)}`);

  const result = await executeReadTool(
    { targets: [{ path: "huge's.txt", offset: 2 }], show_line_numbers: true },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );

  const output = textOutput(result);
  assert.match(output, /\[Line 2 is (?:at least )?60\.0KB, exceeds 50\.0KB limit\./u);
  assert.match(output, /nl -ba -- '.*huge'"'"'s\.txt'/u);
  assert.match(output, /sed -n '2p'/u);
  assert.match(output, /head -c 51200\]/u);
  assert.equal(result.details.targets[0]?.truncated, true);
});

test("reports target errors without dropping successful targets", async (t) => {
  const cwd = await createTempWorkspace(t);
  await writeWorkspaceFile(cwd, "ok.txt", "ok");

  const result = await executeReadTool(
    { targets: [{ path: "missing.txt" }, { path: "ok.txt" }] },
    cwd,
    undefined,
    createBuiltInRead(cwd),
  );

  assert.match(textOutput(result), /[=][=]> missing\.txt <[=][=]\nerror: /u);
  assert.match(textOutput(result), /[=][=]> ok\.txt <[=][=]\nok/u);
  assert.equal(result.details.targets[0]?.kind, "error");
  assert.equal(result.details.targets[1]?.kind, "file");
});
