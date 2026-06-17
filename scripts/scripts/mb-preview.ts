import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { fstatSync } from "node:fs";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { marked, Renderer, type Tokens } from "marked";

interface PreviewArgs {
  readonly inputPath: string | null;
  readonly outputPath: string | null;
  readonly title: string | null;
  readonly baseDir: string | null;
  readonly open: boolean;
  readonly help: boolean;
}

interface RenderedMarkdown {
  readonly html: string;
  readonly hasMermaid: boolean;
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
  const rendered = await renderMarkdown(markdown);
  const html = await renderDocument(rendered.html, rendered.hasMermaid, title, baseHref);
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

export async function renderMarkdown(
  markdown: string,
  renderGraphviz: GraphvizRenderer = renderGraphvizToSvg,
): Promise<RenderedMarkdown> {
  let hasMermaid = false;
  const graphvizBlocks: Array<{ readonly placeholder: string; readonly dot: string }> = [];
  const renderer = new Renderer();
  const defaultCodeRenderer = renderer.code.bind(renderer);

  renderer.code = (token: Tokens.Code): string => {
    const language = token.lang?.trim().split(/\s+/, 1)[0]?.toLowerCase();

    if (language === "mermaid") {
      hasMermaid = true;
      return `<pre class="mermaid">${escapeHtml(token.text)}</pre>\n`;
    }

    if (language !== undefined && graphvizLanguages.has(language)) {
      const placeholder = `<!--MB_PREVIEW_GRAPHVIZ_${graphvizBlocks.length}-->`;
      graphvizBlocks.push({ placeholder, dot: token.text });
      return placeholder;
    }

    return defaultCodeRenderer(token);
  };

  let html = marked(markdown, { async: false, gfm: true, renderer });

  for (const block of graphvizBlocks) {
    const rendered = await renderGraphviz(block.dot);
    html = html.replace(
      block.placeholder,
      rendered.ok
        ? renderGraphvizSvg(rendered.svg)
        : renderGraphvizFailure(block.dot, rendered.error),
    );
  }

  return {
    html,
    hasMermaid,
  };
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

function renderGraphvizSvg(svg: string): string {
  const encoded = Buffer.from(svg, "utf8").toString("base64");
  return `<figure class="graphviz-diagram"><img alt="Graphviz diagram" src="data:image/svg+xml;base64,${encoded}"></figure>\n`;
}

function renderGraphvizFailure(dot: string, error: string): string {
  return `<figure class="graphviz-error">
<figcaption>Graphviz render failed: ${escapeHtml(error)}</figcaption>
<pre><code class="language-dot">${escapeHtml(dot)}</code></pre>
</figure>\n`;
}

async function renderDocument(
  bodyHtml: string,
  hasMermaid: boolean,
  title: string,
  baseHref: string | null,
): Promise<string> {
  const mermaidScript = hasMermaid ? await mermaidInitializerScript() : "";
  const baseElement = baseHref === null ? "" : `  <base href="${escapeHtml(baseHref)}">\n`;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
${baseElement}  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: light dark; }
    body {
      box-sizing: border-box;
      max-width: 900px;
      margin: 0 auto;
      padding: 2rem;
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
    .graphviz-diagram { margin: 1rem 0; overflow-x: auto; }
    .graphviz-diagram img { display: block; max-width: 100%; }
    .graphviz-error { margin: 1rem 0; }
    .graphviz-error figcaption { color: #b00020; font-weight: 600; }
  </style>
</head>
<body>
${bodyHtml}
${mermaidScript}
</body>
</html>
`;
}

async function mermaidInitializerScript(): Promise<string> {
  const mermaidPath = fileURLToPath(import.meta.resolve("mermaid/dist/mermaid.min.js"));
  const mermaidJs = await readFile(mermaidPath, "utf8");

  return `<script>
${inlineScriptContent(mermaidJs)}
globalThis.mermaid.initialize({ startOnLoad: true });
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
