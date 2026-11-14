import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

import { NodeRuntime, NodeServices, NodeStream } from "@effect/platform-node";
import { ByteSize, Console, Effect, FileSystem, Option, Stream } from "effect";
import type { PlatformError } from "effect";
import { Duration } from "effect";
import { Argument, Command, Flag } from "effect/cli";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { marked, type Token, type Tokens } from "marked";

import { logEvent, withExecutionLog } from "../lib/execution-log.ts";

interface PreparedMarkdown {
  readonly markdown: string;
  readonly embeddedImages: Readonly<Record<string, string>>;
  readonly hasMermaid: boolean;
  readonly hasGraphviz: boolean;
  readonly hasDiagrams: boolean;
  readonly graphvizBlocks: readonly BrowserGraphvizBlock[];
}

interface PrepareMarkdownOptions {
  readonly renderGraphviz?: (
    dot: string,
  ) => Effect.Effect<GraphvizRenderResult, never, ChildProcessSpawner.ChildProcessSpawner>;
  readonly embedImagesBaseDir?: string | null;
}

interface BrowserGraphvizBlock {
  readonly id: string;
  readonly language: string;
  readonly source: string;
  readonly result: GraphvizRenderResult;
}

interface GraphvizRenderSuccess {
  readonly ok: true;
  readonly svg: string;
}

interface GraphvizRenderFailure {
  readonly ok: false;
  readonly error: string;
}

type GraphvizRenderResult = GraphvizRenderSuccess | GraphvizRenderFailure;

const graphvizLanguages = new Set(["dot", "graphviz", "gv"]);
const graphvizInputMaxBytes = 256 * 1024;
const graphvizOutputMaxBytes = 2 * 1024 * 1024;
const graphvizTimeoutMs = 5_000;
const imageInputMaxBytes = 16 * 1024 * 1024;
const imageInputTotalMaxBytes = 64 * 1024 * 1024;

const imageMimeTypes = new Map([
  [".apng", "image/apng"],
  [".avif", "image/avif"],
  [".bmp", "image/bmp"],
  [".gif", "image/gif"],
  [".ico", "image/x-icon"],
  [".jpeg", "image/jpeg"],
  [".jpg", "image/jpeg"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webp", "image/webp"],
]);

interface PreviewOptions {
  readonly input: Option.Option<string>;
  readonly out: Option.Option<string>;
  readonly title: Option.Option<string>;
  readonly baseDir: Option.Option<string>;
  readonly embedImages: boolean;
  readonly open: boolean;
}

const preview = Command.make(
  "mb-preview",
  {
    input: Argument.String("file.md").pipe(Argument.optional),
    open: Flag.Boolean("open").pipe(Flag.withAlias("b"), Flag.withDefault(false)),
    out: Flag.String("out").pipe(Flag.withAlias("o"), Flag.optional),
    title: Flag.String("title").pipe(Flag.optional),
    baseDir: Flag.String("base-dir").pipe(Flag.optional),
    embedImages: Flag.Boolean("embed-images").pipe(Flag.withDefault(false)),
  },
  (options) => runPreview(options),
).pipe(Command.withDescription("Render Markdown to a standalone HTML preview."));

function runPreview(
  options: PreviewOptions,
): Effect.Effect<
  void,
  Error | PlatformError.PlatformError,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const inputPath = Option.getOrUndefined(options.input) ?? null;
    const output = Option.getOrUndefined(options.out);
    const titleOption = Option.getOrUndefined(options.title);
    const baseDirectory = Option.getOrUndefined(options.baseDir) ?? null;
    const sourceName = inputPath === null ? "stdin" : path.basename(inputPath);
    const title = titleOption ?? sourceName;
    const imageBaseDir = resolveImageBaseDirectory(inputPath, baseDirectory);
    if (options.embedImages && imageBaseDir === null) {
      yield* Effect.fail(
        new Error("--embed-images requires --base-dir when reading Markdown from stdin."),
      );
    }
    const markdown = yield* readInput(inputPath);
    const prepared = yield* prepareMarkdown(markdown, {
      embedImagesBaseDir: options.embedImages ? imageBaseDir : null,
    });
    const html = yield* renderDocument(
      prepared,
      title,
      baseDirectory === null ? null : baseHrefForDirectory(baseDirectory),
    );
    const outputPath = output ?? (yield* defaultOutputPath(titleOption ?? sourceName));
    const fs = yield* FileSystem.FileSystem;
    yield* fs.makeDirectory(path.dirname(outputPath), { recursive: true });
    yield* fs.writeFileString(outputPath, html);
    yield* Console.log(outputPath);
    yield* logEvent("preview_written", {
      output_path: outputPath,
      diagrams: prepared.graphvizBlocks.length,
    });
    if (options.open) yield* openInBrowser(outputPath);
  });
}

function resolveImageBaseDirectory(
  inputPath: string | null,
  explicitBaseDir: string | null,
): string | null {
  if (explicitBaseDir !== null) {
    return path.resolve(explicitBaseDir);
  }
  return inputPath === null ? null : path.dirname(path.resolve(inputPath));
}

function readInput(
  inputPath: string | null,
): Effect.Effect<string, Error | PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    if (inputPath !== null) {
      return yield* fs.readFileString(inputPath);
    }

    if (process.stdin.isTTY)
      return yield* Effect.fail(new Error("Missing input file or piped stdin."));
    return yield* NodeStream.toString(() => process.stdin, {
      onError: (error) => (error instanceof Error ? error : new Error(String(error))),
    });
  });
}

export function prepareMarkdown(
  markdown: string,
  options: PrepareMarkdownOptions = {},
): Effect.Effect<
  PreparedMarkdown,
  Error | PlatformError.PlatformError,
  FileSystem.FileSystem | ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    let hasGraphviz = false;
    const replaced = replaceGraphvizFences(markdown);
    const graphvizBlocks: BrowserGraphvizBlock[] = [];
    const renderGraphviz = options.renderGraphviz ?? renderGraphvizToSvg;

    for (const block of replaced.graphvizSources) {
      const rendered = yield* renderGraphviz(block.source);
      if (rendered.ok) {
        hasGraphviz = true;
      }
      graphvizBlocks.push({ ...block, result: rendered });
    }

    return {
      markdown: replaced.markdown,
      embeddedImages:
        options.embedImagesBaseDir === undefined || options.embedImagesBaseDir === null
          ? {}
          : yield* embedMarkdownImages(replaced.markdown, options.embedImagesBaseDir),
      hasMermaid: replaced.hasMermaid,
      hasGraphviz,
      hasDiagrams: replaced.hasMermaid || hasGraphviz,
      graphvizBlocks,
    };
  });
}

function embedMarkdownImages(
  markdown: string,
  baseDir: string,
): Effect.Effect<
  Readonly<Record<string, string>>,
  Error | PlatformError.PlatformError,
  FileSystem.FileSystem
> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const hrefs = new Set<string>();
    const tokens = marked.lexer(markdown, { gfm: true });

    void marked.walkTokens(tokens, (token) => {
      if (isImageToken(token)) {
        hrefs.add(token.href);
      }
    });

    const embeddedImages: Record<string, string> = {};
    let totalBytes = 0;

    for (const href of hrefs) {
      const localImage = yield* resolveLocalImage(href, baseDir);
      if (localImage === null) {
        continue;
      }

      const mimeType = imageMimeTypes.get(path.extname(localImage.filePath).toLowerCase());
      if (mimeType === undefined) {
        return yield* Effect.fail(
          new Error(`Cannot embed image "${href}": unsupported image format.`),
        );
      }

      let fileStats;
      fileStats = yield* fs
        .stat(localImage.filePath)
        .pipe(
          Effect.mapError(
            (error) =>
              new Error(
                `Cannot embed image "${href}" from ${localImage.filePath}: ${errorMessage(error)}`,
                { cause: error },
              ),
          ),
        );

      if (fileStats.type !== "File") {
        return yield* Effect.fail(
          new Error(`Cannot embed image "${href}": ${localImage.filePath} is not a file.`),
        );
      }
      const statBytes = Number(ByteSize.toBigInt(fileStats.size));
      if (statBytes > imageInputMaxBytes) {
        return yield* Effect.fail(
          new Error(
            `Cannot embed image "${href}": file exceeds ${formatBytes(imageInputMaxBytes)}.`,
          ),
        );
      }
      if (totalBytes + statBytes > imageInputTotalMaxBytes) {
        return yield* Effect.fail(
          new Error(
            `Cannot embed images: total size exceeds ${formatBytes(imageInputTotalMaxBytes)}.`,
          ),
        );
      }

      const contents = yield* fs.readFile(localImage.filePath);
      if (contents.byteLength > imageInputMaxBytes) {
        return yield* Effect.fail(
          new Error(
            `Cannot embed image "${href}": file exceeds ${formatBytes(imageInputMaxBytes)}.`,
          ),
        );
      }
      if (totalBytes + contents.byteLength > imageInputTotalMaxBytes) {
        return yield* Effect.fail(
          new Error(
            `Cannot embed images: total size exceeds ${formatBytes(imageInputTotalMaxBytes)}.`,
          ),
        );
      }

      totalBytes += contents.byteLength;
      embeddedImages[href] =
        `data:${mimeType};base64,${Buffer.from(contents).toString("base64")}${localImage.fragment}`;
    }

    return embeddedImages;
  });
}

interface LocalImage {
  readonly filePath: string;
  readonly fragment: string;
}

function resolveLocalImage(href: string, baseDir: string): Effect.Effect<LocalImage | null, Error> {
  return Effect.gen(function* () {
    // Mirror browser HTML/URL processing: decode supported character references,
    // then escape only bare percent signs before Node parses the file URL.
    const browserHref = decodeImageHrefReferences(href);
    if (browserHref.startsWith("//")) {
      return null;
    }

    const url = yield* Effect.try({
      try: () => {
        const normalizedHref = browserHref.replaceAll(/%(?![0-9A-Fa-f]{2})/gu, "%25");
        return new URL(normalizedHref, baseHrefForDirectory(baseDir));
      },
      catch: () => new Error(`Cannot embed image "${href}": invalid image URL.`),
    });

    if (url.protocol !== "file:") {
      return null;
    }

    const fragment = url.hash;
    url.hash = "";
    url.search = "";

    const filePath = yield* Effect.try({
      try: () => fileURLToPath(url),
      catch: (error) =>
        new Error(`Cannot embed image "${href}": ${errorMessage(error)}`, { cause: error }),
    });
    return { filePath, fragment };
  });
}

function decodeImageHrefReferences(href: string): string {
  return href.replace(
    /&(?:amp;|#([0-9]+);|#x([0-9A-Fa-f]+);)/gu,
    (reference, decimal: string | undefined, hexadecimal: string | undefined) => {
      if (decimal === undefined && hexadecimal === undefined) {
        return "&";
      }

      const digits = decimal ?? hexadecimal;
      if (digits === undefined) {
        return reference;
      }
      const codePoint =
        decimal === undefined ? Number.parseInt(digits, 16) : Number.parseInt(digits, 10);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) {
        return reference;
      }
      return String.fromCodePoint(codePoint);
    },
  );
}

function isImageToken(token: Token): token is Tokens.Image {
  return token.type === "image" && "href" in token && typeof token.href === "string";
}

interface GraphvizSource {
  readonly id: string;
  readonly language: string;
  readonly source: string;
}

interface ReplacedGraphvizFences {
  readonly markdown: string;
  readonly graphvizSources: readonly GraphvizSource[];
  readonly hasMermaid: boolean;
}

interface FenceOpening {
  readonly indent: string;
  readonly fence: string;
  readonly language: string | null;
  readonly rawInfo: string;
  readonly lineEnding: string;
}

function replaceGraphvizFences(markdown: string): ReplacedGraphvizFences {
  const lines = markdown.split(/(?<=\n)/u);
  const output: string[] = [];
  const graphvizSources: GraphvizSource[] = [];
  let hasMermaid = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line === undefined) {
      break;
    }

    const opening = parseFenceOpening(line);
    if (opening === null) {
      output.push(line);
      continue;
    }

    if (opening.language === "mermaid") {
      hasMermaid = true;
    }
    const contentLines: string[] = [];
    let closingLine: string | null = null;

    index += 1;
    for (; index < lines.length; index += 1) {
      const contentLine = lines[index];
      if (contentLine === undefined) {
        break;
      }
      if (isFenceClosing(contentLine, opening.fence)) {
        closingLine = contentLine;
        break;
      }
      contentLines.push(contentLine);
    }

    if (opening.language === null || !graphvizLanguages.has(opening.language)) {
      output.push(renderOriginalFence(opening, contentLines, closingLine));
      continue;
    }

    const id = `MB_PREVIEW_GRAPHVIZ_${graphvizSources.length}`;
    const source = stripSingleTrailingLineEnding(contentLines.join(""));
    graphvizSources.push({ id, language: opening.language, source });
    output.push(renderPreparedGraphvizFence(opening, id, contentLines, closingLine));
  }

  return {
    markdown: output.join(""),
    graphvizSources,
    hasMermaid,
  };
}

function parseFenceOpening(line: string): FenceOpening | null {
  const match = /^( {0,3})(`{3,}|~{3,})([^\r\n]*)(\r?\n)?$/u.exec(line);
  if (match === null) {
    return null;
  }

  const indent = match[1];
  const fence = match[2];
  const rawInfo = match[3];
  if (indent === undefined || fence === undefined || rawInfo === undefined) {
    return null;
  }
  const lineEnding = match[4] ?? "";
  if (fence.startsWith("`") && rawInfo.includes("`")) {
    return null;
  }

  const info = rawInfo.trim();
  const [language] = info.split(/\s+/u, 1);
  return {
    indent,
    fence,
    language: language === undefined || language === "" ? null : language.toLowerCase(),
    rawInfo,
    lineEnding,
  };
}

function isFenceClosing(line: string, openingFence: string): boolean {
  const marker = escapeRegExp(openingFence.charAt(0));
  const minLength = openingFence.length;
  return new RegExp(`^ {0,3}${marker}{${minLength},}[ \t]*(?:\r?\n)?$`, "u").test(line);
}

function renderOriginalFence(
  opening: FenceOpening,
  contentLines: readonly string[],
  closingLine: string | null,
): string {
  return `${opening.indent}${opening.fence}${opening.rawInfo}${opening.lineEnding}${contentLines.join("")}${closingLine ?? ""}`;
}

function renderPreparedGraphvizFence(
  opening: FenceOpening,
  id: string,
  contentLines: readonly string[],
  closingLine: string | null,
): string {
  return `${opening.indent}${opening.fence}mb-preview-graphviz ${id} ${opening.language ?? "dot"}${opening.lineEnding}${contentLines.join("")}${closingLine ?? ""}`;
}

function stripSingleTrailingLineEnding(value: string): string {
  return value.replace(/\r?\n$/u, "");
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

export function renderGraphvizToSvg(
  dot: string,
): Effect.Effect<GraphvizRenderResult, never, ChildProcessSpawner.ChildProcessSpawner> {
  if (Buffer.byteLength(dot, "utf8") > graphvizInputMaxBytes) {
    return Effect.succeed({
      ok: false,
      error: `Graphviz input exceeds ${formatBytes(graphvizInputMaxBytes)}.`,
    });
  }

  const render = Effect.gen(function* () {
    yield* logEvent("graphviz_started", { input_bytes: Buffer.byteLength(dot, "utf8") });
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("dot", ["-Tsvg"], {
        stdin: Stream.make(new TextEncoder().encode(dot)),
        stdout: "pipe",
        stderr: "pipe",
        forceKillAfter: "1 second",
      }),
    );
    let outputBytes = 0;
    let stdout = "";
    let stderr = "";
    const drainStdout = child.stdout.pipe(
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.suspend(() => {
          outputBytes += Buffer.byteLength(chunk);
          if (outputBytes > graphvizOutputMaxBytes) return Effect.fail(new Error("output-limit"));
          stdout += chunk;
          return Effect.void;
        }),
      ),
    );
    const drainStderr = child.stderr.pipe(
      Stream.tap((chunk) => Effect.sync(() => process.stderr.write(chunk))),
      Stream.decodeText(),
      Stream.runForEach((chunk) =>
        Effect.gen(function* () {
          stderr += chunk;
          yield* logEvent("graphviz_stderr", { stderr: chunk });
        }),
      ),
    );
    const [,] = yield* Effect.all([drainStdout, drainStderr], { concurrency: "unbounded" });
    const code = yield* child.exitCode;
    if (code !== 0)
      return { ok: false as const, error: stderr.trim() || `exited with code ${code}` };
    return { ok: true as const, svg: stdout };
  }).pipe(Effect.scoped);
  return Effect.raceFirst(
    render.pipe(
      Effect.catch((error) => {
        const message = error instanceof Error ? error.message : String(error);
        return Effect.succeed({
          ok: false as const,
          error:
            message === "output-limit"
              ? `Graphviz output exceeds ${formatBytes(graphvizOutputMaxBytes)}.`
              : message,
        });
      }),
    ),
    Effect.sleep(Duration.millis(graphvizTimeoutMs)).pipe(
      Effect.as({
        ok: false as const,
        error: `Graphviz timed out after ${graphvizTimeoutMs}ms.`,
      }),
    ),
  ).pipe(
    Effect.tap((result) =>
      logEvent("graphviz_finished", {
        outcome: result.ok ? "success" : "failure",
        ...(result.ok ? {} : { error: result.error }),
      }),
    ),
  );
}

export function renderDocument(
  prepared: PreparedMarkdown,
  title: string,
  baseHref: string | null,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const previewScript = yield* previewInitializerScript(prepared.hasMermaid);
    const baseElement = baseHref === null ? "" : `  <base href="${escapeHtml(baseHref)}">\n`;
    const previewData = jsonScriptContent({
      embeddedImages: prepared.embeddedImages,
      graphvizBlocks: prepared.graphvizBlocks,
      markdown: prepared.markdown,
    });
    return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
${baseElement}  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; --page-padding: 2rem; }
    body {
      box-sizing: border-box;
      max-width: 900px;
      margin: 0 auto;
      padding: var(--page-padding);
      font: 16px/1.5 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    }
    img { max-width: 100%; }
    pre {
      overflow-x: auto;
      padding: 1rem;
      border-radius: 0.4rem;
      background: color-mix(in srgb, CanvasText 8%, Canvas);
    }
    code { font-family: ui-monospace, SFMono-Regular, "SF Mono", Consolas, monospace; }
    table { border-collapse: collapse; }
    th, td { border: 1px solid color-mix(in srgb, CanvasText 25%, Canvas); padding: 0.35rem 0.6rem; }
    blockquote { margin-left: 0; padding-left: 1rem; border-left: 0.25rem solid color-mix(in srgb, CanvasText 25%, Canvas); }
      .diagram {
        width: calc(100vw - var(--page-padding) - var(--page-padding));
        margin: 1.25rem calc(50% - 50vw + var(--page-padding));
      }
      .diagram-card {
        overflow: hidden;
        border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas);
        border-radius: 0.7rem;
        background: Canvas;
        box-shadow: 0 1px 2px color-mix(in srgb, CanvasText 8%, transparent);
      }
      .diagram-toolbar {
        position: sticky;
        top: 0;
        z-index: 1;
        display: flex;
        align-items: center;
        flex-wrap: wrap;
        gap: 0.5rem;
        padding: 0.55rem 0.65rem;
        border-bottom: 1px solid color-mix(in srgb, CanvasText 12%, Canvas);
        background: color-mix(in srgb, CanvasText 3%, Canvas);
      }
      .diagram-toolbar-group {
        display: flex;
        align-items: center;
        gap: 0.2rem;
        padding: 0.15rem;
        border: 1px solid color-mix(in srgb, CanvasText 12%, Canvas);
        border-radius: 0.55rem;
        background: Canvas;
      }
      .diagram-toolbar-spacer {
        flex: 1 1 auto;
        min-width: 0.75rem;
      }
      .diagram-toolbar button {
        min-height: 2rem;
        border: 1px solid transparent;
        border-radius: 0.4rem;
        padding: 0.25rem 0.6rem;
        background: transparent;
        color: CanvasText;
        font: inherit;
        white-space: nowrap;
      }
      .diagram-toolbar button:hover { background: color-mix(in srgb, CanvasText 8%, Canvas); }
      .diagram-toolbar button:focus-visible { outline: 2px solid Highlight; outline-offset: 1px; }
      .diagram-zoom {
        min-width: 3.75rem;
        padding: 0.25rem 0.4rem;
        color: color-mix(in srgb, CanvasText 70%, Canvas);
        text-align: center;
        font-variant-numeric: tabular-nums;
      }
      .diagram-viewport {
        min-height: 12rem;
        max-height: 75vh;
        margin: 0.65rem;
        overflow: auto;
        resize: vertical;
        border: 1px solid color-mix(in srgb, CanvasText 16%, Canvas);
        border-radius: 0.55rem;
        padding: 0.75rem;
        background: color-mix(in srgb, CanvasText 2%, Canvas);
        cursor: grab;
        touch-action: none;
      }
    .diagram-viewport:focus { outline: 2px solid Highlight; outline-offset: 2px; }
    .diagram-viewport.is-panning { cursor: grabbing; user-select: none; }
    .diagram-canvas { position: relative; min-height: 100%; overflow: hidden; }
    .diagram-content { position: absolute; left: 0; top: 0; display: inline-block; transform-origin: 0 0; }
    .diagram-content img, .diagram-content svg { display: block; max-width: none; max-height: none; }
    .diagram-content pre.mermaid { margin: 0; padding: 0; overflow: visible; background: transparent; }
      .diagram-source {
        margin: 0;
        border-top: 1px solid color-mix(in srgb, CanvasText 12%, Canvas);
        background: color-mix(in srgb, CanvasText 3%, Canvas);
      }
      .diagram-source summary {
        padding: 0.45rem 0.65rem;
        cursor: pointer;
      }
      .diagram-source button {
        margin: 0 0.65rem 0.65rem;
        border: 1px solid color-mix(in srgb, CanvasText 18%, Canvas);
        border-radius: 0.4rem;
        padding: 0.25rem 0.6rem;
        background: Canvas;
        color: CanvasText;
        font: inherit;
      }
      .diagram-source button:hover { background: color-mix(in srgb, CanvasText 8%, Canvas); }
      .diagram-source pre { margin: 0; border-radius: 0; }
      .diagram:fullscreen {
        box-sizing: border-box;
        display: flex;
        flex-direction: column;
      width: 100vw;
      height: 100vh;
      margin: 0;
        padding: 1rem;
        background: Canvas;
      }
      .diagram:fullscreen .diagram-card { display: flex; flex: 1; min-height: 0; flex-direction: column; }
      .diagram:fullscreen .diagram-viewport { flex: 1; max-height: none; resize: none; }
    .graphviz-error { margin: 1rem 0; }
    .graphviz-error figcaption { color: #b00020; font-weight: 600; }
  </style>
</head>
<body>
<main id="mb-preview-root">
  <noscript>Enable JavaScript to render this Markdown preview.</noscript>
</main>
<script type="application/json" id="mb-preview-data">${previewData}</script>
${previewScript}
</body>
</html>
`;
  });
}

const previewRendererJs = `(() => {
  const dataElement = document.getElementById("mb-preview-data");
  const root = document.getElementById("mb-preview-root");

  const fail = (message) => {
    if (root !== null) {
      root.textContent = message;
    }
  };

  if (dataElement === null || root === null) {
    fail("Preview data is missing.");
    return;
  }

  if (globalThis.marked === undefined) {
    fail("Marked renderer is unavailable.");
    return;
  }

  if (globalThis.DOMPurify === undefined) {
    fail("HTML sanitizer is unavailable.");
    return;
  }

  const previewData = JSON.parse(dataElement.textContent || "{}");
  const graphvizBlocks = new Map(
    (Array.isArray(previewData.graphvizBlocks) ? previewData.graphvizBlocks : []).map((block) => [block.id, block]),
  );
  const embeddedImages = new Map(
    Object.entries(
      previewData.embeddedImages !== null && typeof previewData.embeddedImages === "object"
        ? previewData.embeddedImages
        : {},
    ),
  );
  globalThis.mbPreviewGraphvizBlocks = graphvizBlocks;

  const markedApi = globalThis.marked;
  const markedFn = typeof markedApi.marked === "function" ? markedApi.marked : markedApi;
  const renderer = new markedApi.Renderer();
  const defaultCodeRenderer = renderer.code.bind(renderer);
  const defaultImageRenderer = renderer.image.bind(renderer);

  const escapeHtml = (value) => String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

  const codeLanguage = (token) => {
    const language = token.lang?.trim().split(/\\s+/, 1)[0]?.toLowerCase();
    return language === undefined || language === "" ? null : language;
  };

  const graphvizBlockId = (token) => {
    const parts = token.lang?.trim().split(/\\s+/) ?? [];
    return parts[0] === "mb-preview-graphviz" ? parts[1] ?? null : null;
  };

  const renderDiagramViewport = (kind, contentHtml, source, sourceLanguage) => {
    const label = kind === "graphviz" ? "Graphviz" : "Mermaid";
    return '<figure class="diagram diagram-' + kind + '">\\n'
      + '<div class="diagram-card">\\n'
      + '<div class="diagram-toolbar" aria-label="' + label + ' diagram controls">\\n'
      + '<div class="diagram-toolbar-group" aria-label="View controls">\\n'
      + '<button type="button" data-diagram-action="fit">Fit</button>\\n'
      + '<button type="button" data-diagram-action="fit-width">Fit width</button>\\n'
      + '</div>\\n'
      + '<div class="diagram-toolbar-group" aria-label="Zoom controls">\\n'
      + '<button type="button" data-diagram-action="zoom-out" aria-label="Zoom out">−</button>\\n'
      + '<span class="diagram-zoom" aria-label="zoom level">100%</span>\\n'
      + '<button type="button" data-diagram-action="zoom-in" aria-label="Zoom in">+</button>\\n'
      + '</div>\\n'
      + '<div class="diagram-toolbar-spacer"></div>\\n'
      + '<div class="diagram-toolbar-group" aria-label="Export controls">\\n'
      + '<button type="button" data-diagram-action="download-svg">Download SVG</button>\\n'
      + '<button type="button" data-diagram-action="download-png">Download PNG</button>\\n'
      + '<button type="button" data-diagram-action="fullscreen">Fullscreen</button>\\n'
      + '</div>\\n'
      + '</div>\\n'
      + '<div class="diagram-viewport" tabindex="0" role="region" aria-label="' + label + ' diagram viewport">\\n'
      + '<div class="diagram-canvas"><div class="diagram-content">' + contentHtml + '</div></div>\\n'
      + '</div>\\n'
      + '<details class="diagram-source">\\n'
      + '<summary>Source</summary>\\n'
      + '<button type="button" data-diagram-action="copy-source">Copy source</button>\\n'
      + '<pre><code class="language-' + escapeHtml(sourceLanguage) + '">' + escapeHtml(source) + '</code></pre>\\n'
      + '</details>\\n'
      + '</div>\\n'
      + '</figure>\\n';
  };

  const renderGraphvizFailure = (source, error) => '<figure class="graphviz-error">\\n'
    + '<figcaption>Graphviz render failed: ' + escapeHtml(error) + '</figcaption>\\n'
    + '<pre><code class="language-dot">' + escapeHtml(source) + '</code></pre>\\n'
    + '</figure>\\n';

  renderer.code = (token) => {
    const language = codeLanguage(token);

    if (language === "mermaid") {
      return renderDiagramViewport(
        "mermaid",
        '<pre class="mermaid">' + escapeHtml(token.text) + '</pre>',
        token.text,
        "mermaid",
      );
    }

    if (language === "mb-preview-graphviz") {
      const id = graphvizBlockId(token);
      const block = id === null ? undefined : graphvizBlocks.get(id);
      if (block === undefined) {
        return renderGraphvizFailure(token.text, "missing pre-rendered Graphviz payload");
      }
      if (block.result.ok !== true) {
        return renderGraphvizFailure(block.source, block.result.error);
      }
      return renderDiagramViewport(
        "graphviz",
        '<div data-graphviz-svg="' + escapeHtml(block.id) + '"></div><noscript>Enable JavaScript to render the Graphviz SVG preview.</noscript>',
        block.source,
        block.language,
      );
    }

    return defaultCodeRenderer(token);
  };

  renderer.image = (token) => {
    const embeddedHref = embeddedImages.get(token.href);
    return defaultImageRenderer(
      embeddedHref === undefined ? token : { ...token, href: embeddedHref },
    );
  };

  const rawHtml = markedFn(previewData.markdown ?? "", { async: false, gfm: true, renderer });
  root.innerHTML = globalThis.DOMPurify.sanitize(rawHtml, {
    USE_PROFILES: { html: true },
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed"],
    FORBID_ATTR: ["style"],
  });
})();`;

const diagramControllerJs = `(() => {
  const absoluteMinScale = 0.05;
  const maxScale = 8;
  const zoomStep = 1.2;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const ready = async () => {
    if (globalThis.mermaid !== undefined) {
      globalThis.mermaid.initialize({ startOnLoad: false });
      await globalThis.mermaid.run({ querySelector: ".mermaid" });
      normalizeMermaidSvgSize();
    }

    renderGraphvizSvgs();

    let diagramIndex = 1;
    for (const diagram of document.querySelectorAll(".diagram")) {
      diagram.dataset.diagramIndex = String(diagramIndex);
      diagramIndex += 1;
      initDiagram(diagram);
    }
  };

  const renderGraphvizSvgs = () => {
    const graphvizBlocks = globalThis.mbPreviewGraphvizBlocks;

    for (const target of document.querySelectorAll("[data-graphviz-svg]")) {
      const content = target.closest(".diagram-content");
      if (content === null) {
        continue;
      }

      const blockId = target.getAttribute("data-graphviz-svg");
      const block = graphvizBlocks instanceof Map && blockId !== null ? graphvizBlocks.get(blockId) : undefined;
      if (block === undefined || block.result.ok !== true) {
        content.textContent = "Graphviz SVG payload is unavailable.";
        continue;
      }

      if (globalThis.DOMPurify === undefined) {
        content.textContent = "Graphviz SVG sanitizer is unavailable.";
        continue;
      }

      const cleanSvg = globalThis.DOMPurify.sanitize(block.result.svg, {
        USE_PROFILES: { svg: true, svgFilters: true },
        FORBID_TAGS: ["foreignObject", "style"],
        FORBID_ATTR: ["style"],
      });

      if (!cleanSvg.includes("<svg")) {
        content.textContent = "Graphviz SVG was removed by the sanitizer.";
        continue;
      }

      content.innerHTML = cleanSvg;
    }
  };

  const normalizeMermaidSvgSize = () => {
    for (const svg of document.querySelectorAll(".diagram-mermaid .diagram-content svg")) {
      svg.style.maxWidth = "none";

      const viewBox = svg.viewBox.baseVal;
      if (viewBox.width > 0 && viewBox.height > 0) {
        svg.setAttribute("width", String(Math.ceil(viewBox.width)));
        svg.setAttribute("height", String(Math.ceil(viewBox.height)));
      }
    }
  };

  const safeFileName = (value) => {
    const safe = value.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
    return safe === "" ? "diagram" : safe;
  };

  const diagramFileStem = (diagram) => {
    const kind = diagram.classList.contains("diagram-graphviz") ? "graphviz" : "mermaid";
    const title = document.title || "preview";
    return safeFileName(title + "-" + kind + "-" + (diagram.dataset.diagramIndex || "1"));
  };

  const parseSvgLength = (value) => {
    if (value === null || !/^[0-9]+(?:[.][0-9]+)?(?:px)?$/.test(value)) {
      return null;
    }

    const parsed = Number.parseFloat(value);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  };

  const svgSize = (svg) => {
    const viewBox = svg.viewBox.baseVal;
    const rect = svg.getBoundingClientRect();
    const width = [parseSvgLength(svg.getAttribute("width")), viewBox.width, rect.width, 1].find(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    );
    const height = [parseSvgLength(svg.getAttribute("height")), viewBox.height, rect.height, 1].find(
      (value) => typeof value === "number" && Number.isFinite(value) && value > 0,
    );
    return { width: Math.ceil(width), height: Math.ceil(height) };
  };

  const exportedSvg = (diagram) => {
    const svg = diagram.querySelector(".diagram-content svg");
    if (svg === null) {
      throw new Error("No rendered SVG found for this diagram.");
    }

    const size = svgSize(svg);
    const clone = svg.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
    clone.setAttribute("width", String(size.width));
    clone.setAttribute("height", String(size.height));

    return {
      fileStem: diagramFileStem(diagram),
      height: size.height,
      svgText: new XMLSerializer().serializeToString(clone),
      width: size.width,
    };
  };

  const downloadBlob = (blob, fileName) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  const downloadSvg = (diagram) => {
    const exported = exportedSvg(diagram);
    downloadBlob(
      new Blob([exported.svgText], { type: "image/svg+xml;charset=utf-8" }),
      exported.fileStem + ".svg",
    );
  };

  const imageFromBlob = async (blob) => {
    const url = URL.createObjectURL(blob);
    try {
      const image = new Image();
      const loaded = new Promise((resolve, reject) => {
        image.addEventListener("load", resolve, { once: true });
        image.addEventListener("error", () => reject(new Error("SVG could not be rasterized.")), {
          once: true,
        });
      });
      image.src = url;
      await loaded;
      return image;
    } finally {
      URL.revokeObjectURL(url);
    }
  };

  const canvasBlob = async (canvas) => {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
    if (blob === null) {
      throw new Error("PNG export failed.");
    }
    return blob;
  };

  const downloadPng = async (diagram) => {
    const exported = exportedSvg(diagram);
    const svgBlob = new Blob([exported.svgText], { type: "image/svg+xml;charset=utf-8" });
    const image = await imageFromBlob(svgBlob);
    const pixelRatio = Math.min(4, Math.max(1, globalThis.devicePixelRatio || 1));
    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(exported.width * pixelRatio);
    canvas.height = Math.ceil(exported.height * pixelRatio);
    const context = canvas.getContext("2d");
    if (context === null) {
      throw new Error("Canvas is unavailable.");
    }

    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.drawImage(image, 0, 0, exported.width, exported.height);
    downloadBlob(await canvasBlob(canvas), exported.fileStem + ".png");
  };

  const copySource = async (diagram, button) => {
    const code = diagram.querySelector(".diagram-source code");
    if (code === null || globalThis.navigator?.clipboard === undefined) {
      throw new Error("Clipboard is unavailable.");
    }

    await globalThis.navigator.clipboard.writeText(code.textContent ?? "");
    button.textContent = "Copied";
    setTimeout(() => {
      button.textContent = "Copy source";
    }, 1_200);
  };

  const initDiagram = (diagram) => {
    const viewport = diagram.querySelector(".diagram-viewport");
    const canvas = diagram.querySelector(".diagram-canvas");
    const content = diagram.querySelector(".diagram-content");
    const zoomIndicator = diagram.querySelector(".diagram-zoom");
    const fullscreenButton = diagram.querySelector('[data-diagram-action="fullscreen"]');

    if (
      viewport === null ||
      canvas === null ||
      content === null ||
      zoomIndicator === null ||
      fullscreenButton === null
    ) {
      return;
    }

    let scale = 1;
    let mode = "fit";
    let pan = null;
    let lastTap = null;

    const naturalSize = () => ({
      width: Math.max(1, content.offsetWidth),
      height: Math.max(1, content.offsetHeight),
    });

    const viewportContentSize = () => {
      const style = getComputedStyle(viewport);
      const horizontalPadding = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
      const verticalPadding = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);

      return {
        height: Math.max(1, viewport.clientHeight - verticalPadding),
        width: Math.max(1, viewport.clientWidth - horizontalPadding),
      };
    };

    const resizeCanvas = () => {
      const size = naturalSize();
      canvas.style.width = Math.ceil(size.width * scale) + "px";
      canvas.style.height = Math.ceil(size.height * scale) + "px";
    };

    const updateZoomIndicator = () => {
      zoomIndicator.textContent = Math.round(scale * 100) + "%";
    };

    const fitAllScale = () => {
      const size = naturalSize();
      const viewportSize = viewportContentSize();
      return Math.min(1, viewportSize.width / size.width, viewportSize.height / size.height);
    };

    const minUsefulScale = () => Math.max(absoluteMinScale, fitAllScale());

    const applyScale = (nextScale, anchor = null, options = {}) => {
      const previousScale = scale;
      const previousLeft = viewport.scrollLeft;
      const previousTop = viewport.scrollTop;
      const rect = viewport.getBoundingClientRect();
      const anchorX = anchor === null ? viewport.clientWidth / 2 : anchor.clientX - rect.left;
      const anchorY = anchor === null ? viewport.clientHeight / 2 : anchor.clientY - rect.top;

      const minScale = options.allowBelowUsefulMin === true ? absoluteMinScale : minUsefulScale();
      scale = clamp(nextScale, minScale, maxScale);
      content.style.transform = "scale(" + scale + ")";
      resizeCanvas();
      updateZoomIndicator();

      const ratio = scale / previousScale;
      viewport.scrollLeft = (previousLeft + anchorX) * ratio - anchorX;
      viewport.scrollTop = (previousTop + anchorY) * ratio - anchorY;
    };

    const fit = () => {
      mode = "fit";
      applyScale(fitAllScale(), null, { allowBelowUsefulMin: true });
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    };

    const fitWidth = () => {
      const size = naturalSize();
      const viewportSize = viewportContentSize();
      mode = "width";
      applyScale(viewportSize.width / size.width);
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    };

    const actualSize = () => {
      mode = "actual";
      applyScale(1);
      viewport.scrollLeft = 0;
      viewport.scrollTop = 0;
    };

    const applyInitialView = () => {
      const size = naturalSize();
      const viewportSize = viewportContentSize();
      const horizontalScale = viewportSize.width / size.width;
      const verticalScale = viewportSize.height / size.height;
      const fitScale = Math.min(1, horizontalScale, verticalScale);
      const widthScale = Math.min(1, horizontalScale);

      if (size.width <= viewportSize.width && size.height <= viewportSize.height) {
        actualSize();
      } else if (widthScale > fitScale * 1.25) {
        fitWidth();
      } else {
        fit();
      }
    };

    const setManualScale = (nextScale, anchor = null) => {
      mode = "manual";
      applyScale(nextScale, anchor);
    };

    const toggleFullscreen = async () => {
      if (document.fullscreenElement === diagram) {
        await document.exitFullscreen();
      } else if (diagram.requestFullscreen !== undefined) {
        await diagram.requestFullscreen();
      }
    };

    const handleTap = (event) => {
      const tap = { time: Date.now(), x: event.clientX, y: event.clientY };
      if (
        lastTap !== null &&
        tap.time - lastTap.time <= 300 &&
        Math.hypot(tap.x - lastTap.x, tap.y - lastTap.y) <= 32
      ) {
        lastTap = null;
        setManualScale(scale * zoomStep, event);
        return;
      }

      lastTap = tap;
    };

    diagram.addEventListener("click", (event) => {
      if (!(event.target instanceof Element)) {
        return;
      }

      const button = event.target.closest("[data-diagram-action]");
      if (button === null) {
        return;
      }

      const action = button.getAttribute("data-diagram-action");
      if (action === "fit") {
        fit();
      } else if (action === "fit-width") {
        fitWidth();
      } else if (action === "zoom-in") {
        setManualScale(scale * zoomStep);
      } else if (action === "zoom-out") {
        setManualScale(scale / zoomStep);
      } else if (action === "fullscreen") {
        toggleFullscreen().catch((error) => {
          console.error("mb-preview fullscreen failed", error);
        });
      } else if (action === "download-svg") {
        try {
          downloadSvg(diagram);
        } catch (error) {
          console.error("mb-preview SVG download failed", error);
        }
      } else if (action === "download-png") {
        downloadPng(diagram).catch((error) => {
          console.error("mb-preview PNG download failed", error);
        });
      } else if (action === "copy-source") {
        copySource(diagram, button).catch((error) => {
          console.error("mb-preview source copy failed", error);
        });
      }
    });

    document.addEventListener("fullscreenchange", () => {
      fullscreenButton.textContent = document.fullscreenElement === diagram ? "Exit fullscreen" : "Fullscreen";

      if (mode !== "manual") {
        requestAnimationFrame(applyInitialView);
      }
    });

    viewport.addEventListener(
      "wheel",
      (event) => {
        if (!event.ctrlKey && !event.metaKey) {
          return;
        }
        event.preventDefault();
        setManualScale(scale * (event.deltaY < 0 ? zoomStep : 1 / zoomStep), event);
      },
      { passive: false },
    );

    viewport.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) {
        return;
      }
      if (event.target instanceof Element && event.target.closest("a, button, input, select, textarea")) {
        return;
      }

      pan = {
        pointerId: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        left: viewport.scrollLeft,
        top: viewport.scrollTop,
        moved: false,
      };
      viewport.classList.add("is-panning");
      viewport.setPointerCapture(event.pointerId);
    });

    viewport.addEventListener("pointermove", (event) => {
      if (pan === null || event.pointerId !== pan.pointerId) {
        return;
      }
      if (Math.hypot(event.clientX - pan.x, event.clientY - pan.y) > 6) {
        pan.moved = true;
      }
      viewport.scrollLeft = pan.left - (event.clientX - pan.x);
      viewport.scrollTop = pan.top - (event.clientY - pan.y);
    });

    const stopPan = (event) => {
      if (pan === null || event.pointerId !== pan.pointerId) {
        return;
      }
      if (!pan.moved) {
        handleTap(event);
      }
      pan = null;
      viewport.classList.remove("is-panning");
    };
    viewport.addEventListener("pointerup", stopPan);
    viewport.addEventListener("pointercancel", stopPan);

    for (const image of content.querySelectorAll("img")) {
      if (!image.complete) {
        image.addEventListener("load", fit, { once: true });
      }
    }

    if (globalThis.ResizeObserver !== undefined) {
      new ResizeObserver(() => {
        if (mode === "width") {
          fitWidth();
        } else if (mode === "fit") {
          fit();
        } else if (mode === "actual") {
          actualSize();
        } else {
          applyScale(scale);
        }
      }).observe(viewport);
    }

    requestAnimationFrame(applyInitialView);
  };

  ready().catch((error) => {
    console.error("mb-preview diagram initialization failed", error);
  });
})();`;

function previewInitializerScript(
  hasMermaid: boolean,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const markedPackagePath = fileURLToPath(import.meta.resolve("marked/package.json"));
    const markedJs = yield* fs.readFileString(
      path.join(path.dirname(markedPackagePath), "lib/marked.umd.js"),
    );
    const domPurifyJs = yield* fs.readFileString(
      fileURLToPath(import.meta.resolve("dompurify/dist/purify.min.js")),
    );
    const mermaidJs = hasMermaid
      ? yield* fs.readFileString(
          fileURLToPath(import.meta.resolve("@mermaid-js/tiny/dist/mermaid.tiny.js")),
        )
      : "";

    return `<script>
${inlineScriptContent(`${markedJs}
${domPurifyJs}
${mermaidJs}
${previewRendererJs}
${diagramControllerJs}`)}
</script>`;
  });
}

function defaultOutputPath(
  sourceName: string,
): Effect.Effect<string, PlatformError.PlatformError, FileSystem.FileSystem> {
  return Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const dir = yield* fs.makeTempDirectory({ prefix: "mb-preview-" });
    return path.join(dir, `${htmlBaseName(sourceName)}.html`);
  });
}

function htmlBaseName(sourceName: string): string {
  if (sourceName === "stdin") {
    return "stdin";
  }

  const extension = path.extname(sourceName);
  const basename = extension === "" ? sourceName : sourceName.slice(0, -extension.length);
  const safeName = basename
    .normalize("NFC")
    .replaceAll(/[^\p{L}\p{M}\p{N}._-]+/gu, "-")
    .replaceAll(/^-+|-+$/gu, "");
  return safeName === "" ? "preview" : safeName;
}

function baseHrefForDirectory(rawDirectory: string): string {
  const absoluteDirectory = path.resolve(rawDirectory);
  const directoryWithSeparator = absoluteDirectory.endsWith(path.sep)
    ? absoluteDirectory
    : `${absoluteDirectory}${path.sep}`;
  return pathToFileURL(directoryWithSeparator).href;
}

function openInBrowser(
  filePath: string,
): Effect.Effect<
  void,
  Error | PlatformError.PlatformError,
  ChildProcessSpawner.ChildProcessSpawner
> {
  return Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const child = yield* spawner.spawn(
      ChildProcess.make("xdg-open", [filePath], {
        detached: true,
        stdin: "ignore",
        stdout: "ignore",
        stderr: "ignore",
      }),
    );
    yield* child.unref;
    yield* logEvent("browser_open_started", { output_path: filePath, pid: child.pid });
  }).pipe(
    Effect.scoped,
    Effect.catch((error) =>
      Effect.fail(new Error(`Cannot open preview: ${errorMessage(error)}`, { cause: error })),
    ),
  );
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function jsonScriptContent(value: unknown): string {
  return JSON.stringify(value)
    .replaceAll("&", "\\u0026")
    .replaceAll("<", "\\u003C")
    .replaceAll(">", "\\u003E")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function inlineScriptContent(value: string): string {
  return value
    .replaceAll("</script", "<\\/script")
    .replaceAll("<!--", "<\\!--")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");
}

function formatBytes(bytes: number): string {
  if (bytes % 1024 === 0) {
    return `${bytes / 1024}KiB`;
  }
  return `${bytes} bytes`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  NodeRuntime.runMain(
    withExecutionLog("mb-preview", preview.pipe(Command.run({ version: "1.0.0" }))).pipe(
      Effect.tapError((error) => Console.error(errorMessage(error))),
      Effect.provide(NodeServices.layer),
    ),
    { disableErrorReporting: true },
  );
}
