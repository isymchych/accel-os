import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { prepareMarkdown, renderDocument, renderGraphvizToSvg } from "./mb-preview.ts";

class FakeGraphvizChild extends EventEmitter {
  public readonly stdin = new PassThrough();
  public readonly stdout = new PassThrough();
  public readonly stderr = new PassThrough();
  public killed = false;

  public kill(): boolean {
    this.killed = true;
    return true;
  }

  public emitClose(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("close", code, signal);
  }
}

test("prepareMarkdown pre-renders graphviz fences and leaves browser rendering to marked", async () => {
  const calls: string[] = [];

  const prepared = await prepareMarkdown(
    "before\n\n```dot\ndigraph { a -> b }\n```\n\nafter",
    async (dot) => {
      calls.push(dot);
      return { ok: true, svg: "<svg>diagram</svg>" };
    },
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
  const prepared = await prepareMarkdown("```graphviz\ndigraph { a -> }\n```", async () => ({
    ok: false,
    error: "syntax <bad>",
  }));

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
  const prepared = await prepareMarkdown(markdown, async () => {
    throw new Error("graphviz renderer should not be called");
  });

  assert.equal(prepared.markdown, markdown);
  assert.equal(prepared.hasMermaid, true);
  assert.equal(prepared.hasGraphviz, false);
  assert.equal(prepared.hasDiagrams, true);
  assert.deepEqual(prepared.graphvizBlocks, []);
});

test("prepareMarkdown preserves normal code fence info strings", async () => {
  const markdown = "```ts title=example.ts\nconst x = 1;\n```";
  const prepared = await prepareMarkdown(markdown, async () => {
    throw new Error("graphviz renderer should not be called");
  });

  assert.equal(prepared.markdown, markdown);
  assert.equal(prepared.hasDiagrams, false);
});

test("renderDocument embeds marked, DOMPurify, and escaped preview data", async () => {
  const prepared = await prepareMarkdown(
    "# Hello\n\n<script>alert(1)</script>\n\n<img src=x onerror=alert(1)>\n\n```dot\ndigraph { a -> b }\n```",
    async () => ({ ok: true, svg: "<svg><script>alert(1)</script></svg>" }),
  );

  const html = await renderDocument(prepared, "unsafe </title>", null);

  assert.match(html, /<title>unsafe &lt;\/title&gt;<\/title>/u);
  assert.match(html, /<main id="mb-preview-root">/u);
  assert.match(html, /<script type="application\/json" id="mb-preview-data">/u);
  assert.match(html, /new markedApi\.Renderer\(\)/u);
  assert.match(html, /DOMPurify\.sanitize/u);
  assert.match(html, /"markdown":"# Hello/u);
  assert.match(html, /\\u003Cscript\\u003Ealert\(1\)\\u003C\/script\\u003E/u);
  assert.doesNotMatch(html, /<script>alert\(1\)<\/script>/u);
});

test("renderGraphvizToSvg spawns dot and writes dot input to stdin", async () => {
  const calls: Array<{ command: string; args: readonly string[]; stdin: string }> = [];

  const resultPromise = renderGraphvizToSvg("digraph { a -> b }", (command, args) => {
    const child = new FakeGraphvizChild();
    let stdin = "";

    child.stdin.on("data", (chunk) => {
      stdin += String(chunk);
    });

    child.stdin.on("finish", () => {
      calls.push({ command, args, stdin });
      child.stdout.end("<svg>ok</svg>");
      child.stderr.end();
      queueMicrotask(() => child.emitClose(0));
    });

    return child as unknown as ChildProcessWithoutNullStreams;
  });

  assert.deepEqual(await resultPromise, { ok: true, svg: "<svg>ok</svg>" });
  assert.deepEqual(calls, [{ command: "dot", args: ["-Tsvg"], stdin: "digraph { a -> b }" }]);
});

test("renderGraphvizToSvg returns stderr on non-zero dot exits", async () => {
  const result = await renderGraphvizToSvg("bad", () => {
    const child = new FakeGraphvizChild();
    child.stdin.on("finish", () => {
      child.stderr.end("syntax error\n");
      queueMicrotask(() => child.emitClose(1));
    });
    return child as unknown as ChildProcessWithoutNullStreams;
  });

  assert.deepEqual(result, { ok: false, error: "syntax error" });
});
