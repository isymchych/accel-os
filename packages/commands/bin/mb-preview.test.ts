import assert from "node:assert/strict";
import { execFile, spawnSync } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, truncate, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { NodeServices } from "@effect/platform-node";
import { Effect, Exit, Fiber } from "effect";

import { prepareMarkdown, renderDocument, renderGraphvizToSvg } from "./mb-preview.ts";

const run = <A, E, R>(effect: Effect.Effect<A, E, R>): Promise<A> =>
  Effect.runPromise(Effect.provide(effect, NodeServices.layer) as Effect.Effect<A, E>);

// oxlint-disable-next-line typescript/strict-void-return -- execFile has a native custom promisify implementation.
const execFileAsync = promisify(execFile);

test("prepareMarkdown pre-renders graphviz fences and leaves browser rendering to marked", async () => {
  const calls: string[] = [];

  const prepared = await run(
    prepareMarkdown("before\n\n```dot\ndigraph { a -> b }\n```\n\nafter", {
      renderGraphviz: (dot) => {
        calls.push(dot);
        return Effect.succeed({ ok: true, svg: "<svg>diagram</svg>" });
      },
    }),
  );

  assert.deepEqual(calls, ["digraph { a -> b }"]);
  assert.equal(prepared.hasMermaid, false);
  assert.equal(prepared.hasGraphviz, true);
  assert.equal(prepared.hasDiagrams, true);
  assert.match(prepared.markdown, /```mb-preview-graphviz MB_PREVIEW_GRAPHVIZ_0 dot\n/u);
  assert.match(prepared.markdown, /digraph \{ a -> b \}/u);
  assert.deepEqual(prepared.graphvizBlocks, [
    {
      id: "MB_PREVIEW_GRAPHVIZ_0",
      language: "dot",
      source: "digraph { a -> b }",
      result: { ok: true, svg: "<svg>diagram</svg>" },
    },
  ]);
});

test("prepareMarkdown stores graphviz failures for browser-side error rendering", async () => {
  const prepared = await run(
    prepareMarkdown("```graphviz\ndigraph { a -> }\n```", {
      renderGraphviz: () =>
        Effect.succeed({
          ok: false,
          error: "syntax <bad>",
        }),
    }),
  );

  assert.equal(prepared.hasGraphviz, false);
  assert.equal(prepared.hasDiagrams, false);
  assert.equal(prepared.graphvizBlocks[0]?.result.ok, false);
  assert.deepEqual(prepared.graphvizBlocks[0], {
    id: "MB_PREVIEW_GRAPHVIZ_0",
    language: "graphviz",
    source: "digraph { a -> }",
    result: { ok: false, error: "syntax <bad>" },
  });
});

test("prepareMarkdown detects mermaid fences without invoking graphviz", async () => {
  const markdown = "```mermaid\ngraph TD; A-->B\n```";
  const prepared = await run(prepareMarkdown(markdown));

  assert.equal(prepared.markdown, markdown);
  assert.equal(prepared.hasMermaid, true);
  assert.equal(prepared.hasGraphviz, false);
  assert.equal(prepared.hasDiagrams, true);
  assert.deepEqual(prepared.graphvizBlocks, []);
});

test("renderDocument embeds Mermaid Tiny for mermaid fences", async () => {
  const prepared = await run(prepareMarkdown("```mermaid\ngraph TD; A-->B\n```"));
  const html = await run(renderDocument(prepared, "Mermaid preview", null));

  assert.match(html, /__esbuild_esm_mermaid_nm/u);
  assert.match(html, /globalThis\.mermaid\.run/u);
});

test("prepareMarkdown preserves normal code fence info strings", async () => {
  const markdown = "```ts title=example.ts\nconst x = 1;\n```";
  const prepared = await run(prepareMarkdown(markdown));

  assert.equal(prepared.markdown, markdown);
  assert.equal(prepared.hasDiagrams, false);
});

test("renderDocument embeds marked, DOMPurify, and escaped preview data", async () => {
  const prepared = await run(
    prepareMarkdown(
      "# Hello\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n```dot\ndigraph { a -> b }\n```",
      {
        renderGraphviz: () =>
          Effect.succeed({
            ok: true,
            svg: "<svg><script>alert(1)</script></svg>",
          }),
      },
    ),
  );

  const html = await run(renderDocument(prepared, "unsafe </title>", null));

  assert.match(html, /<title>unsafe &lt;\/title&gt;<\/title>/u);
  assert.match(html, /<main id="mb-preview-root">/u);
  assert.match(html, /<script type="application\/json" id="mb-preview-data">/u);
  assert.match(html, /new markedApi\.Renderer\(\)/u);
  assert.match(html, /DOMPurify\.sanitize/u);
  assert.match(html, /"markdown":"# Hello/u);
  assert.match(html, /\\u003Cscript\\u003Ealert\(1\)\\u003C\/script\\u003E/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});

test("default output filenames preserve normalized Unicode letters", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  const outputDirectories = new Set<string>();
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
    await Promise.all(
      [...outputDirectories].map(async (outputDirectory) => {
        await rm(outputDirectory, { recursive: true, force: true });
      }),
    );
  });

  const cases: ReadonlyArray<readonly [inputName: string, expectedOutputName: string]> = [
    ["Документ.md", "Документ.html"],
    ["Cafe\u0301 notes.md", "Café-notes.html"],
    ["!!!.md", "preview.html"],
  ];

  for (const [inputName, expectedOutputName] of cases) {
    const inputPath = path.join(directory, inputName);
    await writeFile(inputPath, "# Section\n");

    const { stdout } = await execFileAsync(process.execPath, [
      path.join(import.meta.dirname, "mb-preview.ts"),
      inputPath,
    ]);
    const outputPath = stdout.trim();
    outputDirectories.add(path.dirname(outputPath));

    assert.equal(path.basename(outputPath), expectedOutputName);
    await assert.doesNotReject(readFile(outputPath, "utf8"));
  }
});

test("only an explicit base directory sets the document base URL", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const inputPath = path.join(directory, "notes.md");
  const outputPath = path.join(directory, "preview.html");
  const explicitOutputPath = path.join(directory, "preview-explicit.html");
  await writeFile(inputPath, "# Section\n\n[Section](#section)\n");

  await execFileAsync(process.execPath, [
    path.join(import.meta.dirname, "mb-preview.ts"),
    "--out",
    outputPath,
    inputPath,
  ]);

  const html = await readFile(outputPath, "utf8");
  assert.doesNotMatch(html, /<base href=/u);

  await execFileAsync(process.execPath, [
    path.join(import.meta.dirname, "mb-preview.ts"),
    "--base-dir",
    directory,
    "--out",
    explicitOutputPath,
    inputPath,
  ]);

  const explicitHtml = await readFile(explicitOutputPath, "utf8");
  assert.ok(
    explicitHtml.includes(`<base href="${pathToFileURL(`${directory}${path.sep}`).href}">`),
  );
});

test("prepareMarkdown embeds inline and reference-style local images", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, "inline.png"), Buffer.from([0, 1, 2]));
  await writeFile(path.join(directory, "reference.svg"), "<svg></svg>");
  await writeFile(path.join(directory, "100%.png"), Buffer.from([3, 4, 5]));
  await writeFile(path.join(directory, "a&b.png"), Buffer.from([6, 7, 8]));
  await writeFile(path.join(directory, "space name.png"), Buffer.from([9, 10, 11]));

  const prepared = await run(
    prepareMarkdown(
      [
        "![inline](inline.png)",
        "![reference][diagram]",
        "![percent](100%.png)",
        "![entity](a&amp;b.png)",
        "![decimal entity](a&#38;b.png)",
        "![hex entity](a&#x26;b.png)",
        "![encoded](space%20name.png#focus)",
        "![remote](https://example.com/image.png)",
        "",
        "[diagram]: reference.svg#shape",
      ].join("\n"),
      { embedImagesBaseDir: directory },
    ),
  );

  assert.deepEqual(prepared.embeddedImages, {
    "inline.png": "data:image/png;base64,AAEC",
    "reference.svg#shape": `data:image/svg+xml;base64,${Buffer.from("<svg></svg>").toString("base64")}#shape`,
    "100%.png": "data:image/png;base64,AwQF",
    "a&amp;b.png": "data:image/png;base64,BgcI",
    "a&#38;b.png": "data:image/png;base64,BgcI",
    "a&#x26;b.png": "data:image/png;base64,BgcI",
    "space%20name.png#focus": "data:image/png;base64,CQoL#focus",
  });
});

test("prepareMarkdown rejects missing and unsupported local images", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(path.join(directory, "image.txt"), "not an image");

  await assert.rejects(
    run(prepareMarkdown("![missing](missing.png)", { embedImagesBaseDir: directory })),
    /Cannot embed image "missing\.png"/u,
  );
  await assert.rejects(
    run(prepareMarkdown("![unsupported](image.txt)", { embedImagesBaseDir: directory })),
    /unsupported image format/u,
  );
  for (const [markdown, message] of [
    ["![unsupported](image.txt)", /unsupported image format/u],
    ["![invalid](bad%2Fname.png)", /Cannot embed image "bad%2Fname\.png"/u],
  ] as const) {
    const error = await run(
      Effect.flip(prepareMarkdown(markdown, { embedImagesBaseDir: directory })),
    );
    assert.match(error.message, message);
  }
});

test("prepareMarkdown enforces the per-image size limit", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(async () => {
    await rm(directory, { recursive: true, force: true });
  });
  const imagePath = path.join(directory, "large.png");
  await writeFile(imagePath, "");
  await truncate(imagePath, 16 * 1024 * 1024 + 1);

  await assert.rejects(
    run(prepareMarkdown("![large](large.png)", { embedImagesBaseDir: directory })),
    /file exceeds 16384KiB/u,
  );
});

test("prepareMarkdown enforces the aggregate image size limit", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const images = Array.from({ length: 5 }, (_, index) => `${index}.png`);
  for (const image of images) {
    const imagePath = path.join(directory, image);
    await writeFile(imagePath, "");
    await truncate(imagePath, 16 * 1024 * 1024);
  }
  await assert.rejects(
    run(
      prepareMarkdown(images.map((image) => `![image](${image})`).join("\n"), {
        embedImagesBaseDir: directory,
      }),
    ),
    /total size exceeds 65536KiB/u,
  );
});

test("CLI reads piped stdin and writes only the output path to stdout", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const output = path.join(directory, "preview.html");
  const result = spawnSync(
    process.execPath,
    [path.join(import.meta.dirname, "mb-preview.ts"), "-o", output],
    { input: "# Piped content\n", encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, `${output}\n`);
  assert.match(await readFile(output, "utf8"), /Piped content/u);
});

test("CLI leaves the browser opener running after it exits", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-open-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const opener = path.join(directory, "xdg-open");
  const marker = path.join(directory, "opened");
  await writeFile(
    opener,
    `#!${process.execPath}\nsetTimeout(() => (awaitImport()), 2000); async function awaitImport() { (await import("node:fs")).writeFileSync(${JSON.stringify(marker)}, process.argv[2]); }\n`,
  );
  await chmod(opener, 0o755);
  const output = path.join(directory, "preview.html");
  const input = path.join(directory, "input.md");
  await writeFile(input, "# Preview\n");
  const result = await execFileAsync(
    process.execPath,
    [path.join(import.meta.dirname, "mb-preview.ts"), "--open", "--out", output, input],
    { env: { ...process.env, PATH: `${directory}${path.delimiter}${process.env["PATH"] ?? ""}` } },
  );
  assert.equal(result.stdout, `${output}\n`);
  await waitForFile(marker);
  assert.equal(await readFile(marker, "utf8"), output);
});

async function waitForFile(filePath: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await readFile(filePath);
      return;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await delay(50);
    }
  }
  throw new Error(`Timed out waiting for ${filePath}`);
}

test("renderGraphvizToSvg rejects oversized input before spawning a process", async () => {
  const result = await run(renderGraphvizToSvg("x".repeat(256 * 1024 + 1)));
  assert.deepEqual(result, { ok: false, error: "Graphviz input exceeds 256KiB." });
});

test("renderGraphvizToSvg streams data, limits output, and times out scoped subprocesses", async (context) => {
  const directory = await mkdtemp(path.join(tmpdir(), "mb-preview-dot-"));
  const executable = path.join(directory, "dot");
  const originalPath = process.env["PATH"];
  context.after(async () => {
    if (originalPath === undefined) delete process.env["PATH"];
    else process.env["PATH"] = originalPath;
    await rm(directory, { recursive: true, force: true });
  });
  await writeFile(
    executable,
    `#!${process.execPath}\nlet input = ""; for await (const chunk of process.stdin) input += chunk; if (input === "large") process.stdout.write(Buffer.alloc(2 * 1024 * 1024 + 1)); else if (input === "slow") { (await import("node:fs")).writeFileSync(${JSON.stringify(path.join(directory, "pid"))}, String(process.pid)); setInterval(() => {}, 1000); } else if (input === "bad") { process.stderr.write("syntax error\\n"); process.exitCode = 1; } else process.stdout.write("<svg>" + input + "</svg>");\n`,
  );
  await chmod(executable, 0o755);
  process.env["PATH"] = `${directory}${path.delimiter}${originalPath ?? ""}`;

  assert.deepEqual(await run(renderGraphvizToSvg("graph input")), {
    ok: true,
    svg: "<svg>graph input</svg>",
  });
  assert.deepEqual(await run(renderGraphvizToSvg("large")), {
    ok: false,
    error: "Graphviz output exceeds 2048KiB.",
  });
  assert.deepEqual(await run(renderGraphvizToSvg("bad")), {
    ok: false,
    error: "syntax error",
  });
  assert.deepEqual(await run(renderGraphvizToSvg("slow")), {
    ok: false,
    error: "Graphviz timed out after 5000ms.",
  });
  const pid = Number(await readFile(path.join(directory, "pid"), "utf8"));
  assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
  await unlink(path.join(directory, "pid"));
  const fiber = Effect.runFork(
    renderGraphvizToSvg("slow").pipe(Effect.provide(NodeServices.layer)),
  );
  await waitForFile(path.join(directory, "pid"));
  const interruptedPid = Number(await readFile(path.join(directory, "pid"), "utf8"));
  await run(Fiber.interrupt(fiber));
  const [exit] = await run(Fiber.awaitAll([fiber]));
  assert.ok(exit && Exit.hasInterrupts(exit));
  assert.throws(() => process.kill(interruptedPid, 0), { code: "ESRCH" });
  await unlink(executable);
  process.env["PATH"] = directory;
  const missing = await run(renderGraphvizToSvg("graph input"));
  assert.equal(missing.ok, false);
  assert.match(missing.error, /ENOENT|not\s?found/iu);
});
