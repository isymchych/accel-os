import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { build, createServer } from "vite";

const workspace = path.resolve(import.meta.dirname, "../..");
const configFile = path.join(workspace, "vite.config.ts");
const sourceHtml = path.join(workspace, "src/renderer/index.html");

function policyFrom(html: string): string {
  const tags = [...html.matchAll(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/g)];
  assert.equal(tags.length, 1, "HTML must contain exactly one CSP");
  const tag = tags[0];
  assert.ok(tag);
  assert.ok(html.indexOf(tag[0]) < html.indexOf("<script"), "CSP must precede scripts");
  const policy = tag[1];
  assert.ok(policy);
  return policy.replaceAll("&#39;", "'");
}

test("development and production renderer HTML use the intended CSP", async (t) => {
  const output = await mkdtemp(path.join(tmpdir(), "workspace-renderer-"));
  t.after(async () => {
    await rm(output, { recursive: true, force: true });
  });
  const server = await createServer({
    configFile,
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  let development: string;
  try {
    development = await server.transformIndexHtml("/", await readFile(sourceHtml, "utf8"));
  } finally {
    await server.close();
  }
  const developmentPolicy = policyFrom(development);
  assert.match(developmentPolicy, /script-src 'self' 'unsafe-inline'/);
  assert.match(developmentPolicy, /connect-src 'self' ws:\/\/127\.0\.0\.1:5173/);
  assert.match(development, /\/@vite\/client/);

  await build({ configFile, logLevel: "silent", build: { outDir: output } });
  const production = await readFile(path.join(output, "index.html"), "utf8");
  const productionPolicy = policyFrom(production);
  assert.match(productionPolicy, /script-src 'self';/);
  assert.match(productionPolicy, /style-src 'self';/);
  assert.match(productionPolicy, /connect-src 'none';/);
  assert.doesNotMatch(productionPolicy, /unsafe-inline/);
  assert.match(production, /src="\.\/assets\//);
});
