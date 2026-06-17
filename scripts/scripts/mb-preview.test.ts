import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import test from "node:test";

import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { renderGraphvizToSvg, renderMarkdown } from "./mb-preview.ts";

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

test("renderMarkdown renders graphviz fences through the graphviz renderer", async () => {
  const calls: string[] = [];

  const rendered = await renderMarkdown(
    "before\n\n```dot\ndigraph { a -> b }\n```\n\nafter",
    async (dot) => {
      calls.push(dot);
      return { ok: true, svg: "<svg>diagram</svg>" };
    },
  );

  assert.deepEqual(calls, ["digraph { a -> b }"]);
  assert.equal(rendered.hasMermaid, false);
  assert.match(rendered.html, /<p>before<\/p>/u);
  assert.match(rendered.html, /<figure class="graphviz-diagram">/u);
  assert.match(
    rendered.html,
    new RegExp(Buffer.from("<svg>diagram</svg>", "utf8").toString("base64"), "u"),
  );
  assert.match(rendered.html, /<p>after<\/p>/u);
});

test("renderMarkdown falls back to an escaped code block when graphviz rendering fails", async () => {
  const rendered = await renderMarkdown("```graphviz\ndigraph { a -> }\n```", async () => ({
    ok: false,
    error: "syntax <bad>",
  }));

  assert.match(rendered.html, /Graphviz render failed: syntax &lt;bad&gt;/u);
  assert.match(rendered.html, /<code class="language-dot">digraph \{ a -&gt; \}<\/code>/u);
});

test("renderMarkdown leaves normal code fences on marked's default renderer", async () => {
  const rendered = await renderMarkdown("```ts\nconst x = 1;\n```", async () => {
    throw new Error("graphviz renderer should not be called");
  });

  assert.match(rendered.html, /<code class="language-ts">const x = 1;\n<\/code>/u);
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
