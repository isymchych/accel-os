import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { parseArgs } from "node:util";

interface PreviewArgs {
  readonly inputPath: string | null;
  readonly outputPath: string | null;
  readonly title: string | null;
  readonly baseDir: string | null;
  readonly open: boolean;
  readonly help: boolean;
}

interface PreparedMarkdown {
  readonly markdown: string;
  readonly hasMermaid: boolean;
  readonly hasGraphviz: boolean;
  readonly hasDiagrams: boolean;
  readonly graphvizBlocks: readonly BrowserGraphvizBlock[];
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

type GraphvizRenderer = (dot: string) => Promise<GraphvizRenderResult>;

type SpawnGraphviz = (
  command: string,
  args: readonly string[],
  options: { readonly stdio: ["pipe", "pipe", "pipe"] },
) => ChildProcessWithoutNullStreams;

const graphvizLanguages = new Set(["dot", "graphviz", "gv"]);
const graphvizInputMaxBytes = 256 * 1024;
const graphvizOutputMaxBytes = 2 * 1024 * 1024;
const graphvizTimeoutMs = 5_000;

const usage = `Usage: mb-preview [--open] [--out <file>] [--title <title>] [--base-dir <dir>] [file.md]

Render Markdown to a standalone HTML file, including Mermaid and Graphviz fenced diagrams.

Options:
  --open, -b        Open the generated HTML with xdg-open
  --out, -o <file>  Write HTML to this path instead of a temp file
  --title <title>   Set the HTML document title
  --base-dir <dir>  Resolve relative local assets from this directory
  --help, -h        Show this help

Input:
  Reads file.md when provided. Otherwise reads piped stdin.
`;

export async function main(): Promise<void> {
  const args = parseCliArgs(process.argv.slice(2));

  if (args.help) {
    process.stdout.write(usage);
    return;
  }

  const sourceName = args.inputPath === null ? "stdin" : path.basename(args.inputPath);
  const title = args.title ?? sourceName;
  const baseHref = args.baseDir === null ? null : baseHrefForDirectory(args.baseDir);
  const markdown = await readInput(args.inputPath);
  const prepared = await prepareMarkdown(markdown);
  const html = await renderDocument(prepared, title, baseHref);
  const outputPath = args.outputPath ?? (await defaultOutputPath(args.title ?? sourceName));

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, html);
  process.stdout.write(`${outputPath}\n`);

  if (args.open) {
    openInBrowser(outputPath);
  }
}

export function parseCliArgs(args: string[]): PreviewArgs {
  const parsed = parseArgs({
    args,
    allowPositionals: true,
    options: {
      help: { type: "boolean", short: "h" },
      open: { type: "boolean", short: "b" },
      out: { type: "string", short: "o" },
      title: { type: "string" },
      "base-dir": { type: "string" },
    },
  });

  if (parsed.positionals.length > 1) {
    throw new Error(
      `Expected at most one input file, got ${parsed.positionals.length}.\n\n${usage}`,
    );
  }

  const [inputPath] = parsed.positionals;

  return {
    inputPath: inputPath ?? null,
    outputPath: parsed.values.out ?? null,
    title: parsed.values.title ?? null,
    baseDir: parsed.values["base-dir"] ?? null,
    open: parsed.values.open === true,
    help: parsed.values.help === true,
  };
}

async function readInput(inputPath: string | null): Promise<string> {
  if (inputPath !== null) {
    return await readFile(inputPath, "utf8");
  }

  if (!hasReadableStdin()) {
    throw new Error(`Missing input file or piped stdin.\n\n${usage}`);
  }

  return await readStream(process.stdin);
}

function hasReadableStdin(): boolean {
  try {
    const stdin = fstatSync(0);
    return stdin.isFIFO() || stdin.isFile() || stdin.isSocket();
  } catch {
    return false;
  }
}

async function readStream(stream: NodeJS.ReadableStream): Promise<string> {
  stream.setEncoding("utf8");

  let data = "";
  for await (const chunk of stream) {
    data += chunk;
  }
  return data;
}

export async function prepareMarkdown(
  markdown: string,
  renderGraphviz: GraphvizRenderer = renderGraphvizToSvg,
): Promise<PreparedMarkdown> {
  let hasMermaid = false;
  let hasGraphviz = false;
  const graphvizSources: Array<{
    readonly id: string;
    readonly language: string;
    readonly source: string;
  }> = [];
  const preparedMarkdown = replaceGraphvizFences(markdown, graphvizSources, (language) => {
    if (language === "mermaid") {
      hasMermaid = true;
    }
  });
  const graphvizBlocks: BrowserGraphvizBlock[] = [];

  for (const block of graphvizSources) {
    const rendered = await renderGraphviz(block.source);
    if (rendered.ok) {
      hasGraphviz = true;
    }
    graphvizBlocks.push({ ...block, result: rendered });
  }

  return {
    markdown: preparedMarkdown,
    hasMermaid,
    hasGraphviz,
    hasDiagrams: hasMermaid || hasGraphviz,
    graphvizBlocks,
  };
}

interface FenceOpening {
  readonly indent: string;
  readonly fence: string;
  readonly language: string | null;
  readonly rawInfo: string;
  readonly lineEnding: string;
}

function replaceGraphvizFences(
  markdown: string,
  graphvizSources: Array<{
    readonly id: string;
    readonly language: string;
    readonly source: string;
  }>,
  observeLanguage: (language: string | null) => void,
): string {
  const lines = markdown.split(/(?<=\n)/u);
  const output: string[] = [];

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

    observeLanguage(opening.language);
    const contentLines: string[] = [];
    let closingLine: string | null = null;

    index += 1;
    for (; index < lines.length; index += 1) {
      const line = lines[index];
      if (line === undefined) {
        break;
      }
      if (isFenceClosing(line, opening.fence)) {
        closingLine = line;
        break;
      }
      contentLines.push(line);
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

  return output.join("");
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
  const [language] = info.split(/\s+/, 1);
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

export async function renderGraphvizToSvg(
  dot: string,
  spawnGraphviz: SpawnGraphviz = spawn,
): Promise<GraphvizRenderResult> {
  if (Buffer.byteLength(dot, "utf8") > graphvizInputMaxBytes) {
    return { ok: false, error: `Graphviz input exceeds ${formatBytes(graphvizInputMaxBytes)}.` };
  }

  return await new Promise<GraphvizRenderResult>((resolve) => {
    let settled = false;
    let outputBytes = 0;
    let stderr = "";
    let stdout = "";

    const child = spawnGraphviz("dot", ["-Tsvg"], { stdio: ["pipe", "pipe", "pipe"] });

    const finish = (result: GraphvizRenderResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      resolve(result);
    };

    const failForLargeOutput = (): void => {
      child.kill();
      finish({
        ok: false,
        error: `Graphviz output exceeds ${formatBytes(graphvizOutputMaxBytes)}.`,
      });
    };

    const timeout = setTimeout(() => {
      child.kill();
      finish({ ok: false, error: `Graphviz timed out after ${graphvizTimeoutMs}ms.` });
    }, graphvizTimeoutMs);

    child.stdout.on("data", (chunk: Buffer | string) => {
      outputBytes += Buffer.byteLength(chunk);
      if (outputBytes > graphvizOutputMaxBytes) {
        failForLargeOutput();
        return;
      }
      stdout += String(chunk);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += String(chunk);
    });

    child.once("error", (error) => {
      finish({ ok: false, error: error.message });
    });

    child.once("close", (code, signal) => {
      if (settled) {
        return;
      }

      if (code === 0) {
        finish({ ok: true, svg: stdout });
        return;
      }

      const detail = stderr.trim() || `exited with ${signal ?? `code ${code}`}`;
      finish({ ok: false, error: detail });
    });

    child.stdin.end(dot);
  });
}

export async function renderDocument(
  prepared: PreparedMarkdown,
  title: string,
  baseHref: string | null,
): Promise<string> {
  const previewScript = await previewInitializerScript(prepared.hasMermaid);
  const baseElement = baseHref === null ? "" : `  <base href="${escapeHtml(baseHref)}">\n`;
  const previewData = jsonScriptContent({
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
  globalThis.mbPreviewGraphvizBlocks = graphvizBlocks;

  const markedApi = globalThis.marked;
  const markedFn = typeof markedApi.marked === "function" ? markedApi.marked : markedApi;
  const renderer = new markedApi.Renderer();
  const defaultCodeRenderer = renderer.code.bind(renderer);

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

async function previewInitializerScript(hasMermaid: boolean): Promise<string> {
  const markedPackagePath = fileURLToPath(import.meta.resolve("marked/package.json"));
  const markedJs = await readFile(
    path.join(path.dirname(markedPackagePath), "lib/marked.umd.js"),
    "utf8",
  );
  const domPurifyJs = await readFile(
    fileURLToPath(import.meta.resolve("dompurify/dist/purify.min.js")),
    "utf8",
  );
  const mermaidJs = hasMermaid
    ? await readFile(fileURLToPath(import.meta.resolve("mermaid/dist/mermaid.min.js")), "utf8")
    : "";

  return `<script>
${inlineScriptContent(`${markedJs}
${domPurifyJs}
${mermaidJs}
${previewRendererJs}
${diagramControllerJs}`)}
</script>`;
}

async function defaultOutputPath(sourceName: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "mb-preview-"));
  return path.join(dir, `${htmlBaseName(sourceName)}.html`);
}

function htmlBaseName(sourceName: string): string {
  if (sourceName === "stdin") {
    return "stdin";
  }

  const extension = path.extname(sourceName);
  const basename = extension === "" ? sourceName : sourceName.slice(0, -extension.length);
  const safeName = basename.replaceAll(/[^A-Za-z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
  return safeName === "" ? "preview" : safeName;
}

function baseHrefForDirectory(rawDirectory: string): string {
  const absoluteDirectory = path.resolve(rawDirectory);
  const directoryWithSeparator = absoluteDirectory.endsWith(path.sep)
    ? absoluteDirectory
    : `${absoluteDirectory}${path.sep}`;
  return pathToFileURL(directoryWithSeparator).href;
}

function openInBrowser(filePath: string): void {
  const lookup = spawnSync("sh", ["-c", "command -v xdg-open >/dev/null 2>&1"], {
    stdio: "ignore",
  });
  if (lookup.status !== 0) {
    throw new Error("Cannot open preview: xdg-open is not available.");
  }

  const child = spawn("xdg-open", [filePath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
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

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  });
}
