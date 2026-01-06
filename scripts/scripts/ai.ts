// ai: thin Codex CLI wrapper for common modifiers.
// Specs:
// - `ai` launches `codex`.
// - `ai +<mcp>` enables MCP server `<mcp>` via `--config mcp_servers.<mcp>.enabled=true`.
// - `ai high` sets `model_reasoning_effort="high"`.
// - `ai yolo` sets `--sandbox danger-full-access`.
// - Modifiers compose and parse left-to-right until `--`.
// - `ai help` prints this usage; `ai -- --help` forwards to codex.

const usage = `ai [high] [yolo] [+<mcp> ...] [-- <codex args...>]

Examples:
  ai
  ai high +serena
  ai yolo +playwright -- --help

Notes:
  - Modifiers parse until \`--\`.
  - Use \`ai -- --help\` to show Codex CLI docs.`;

const configOverrides: string[] = [];
const mcps: string[] = [];
const passthrough: string[] = [];
let sandboxMode: string | null = null;
let parseModifiers = true;
let showHelp = false;

for (const arg of Deno.args) {
  if (!parseModifiers) {
    passthrough.push(arg);
    continue;
  }
  if (arg === "--") {
    parseModifiers = false;
    passthrough.push(arg);
    continue;
  }
  if (arg === "help") {
    showHelp = true;
    continue;
  }
  if (arg === "high") {
    configOverrides.push('model_reasoning_effort="high"');
    continue;
  }
  if (arg === "yolo") {
    sandboxMode = "danger-full-access";
    continue;
  }
  if (arg.startsWith("+") && arg.length > 1) {
    mcps.push(arg.slice(1));
    continue;
  }
  passthrough.push(arg);
}

if (showHelp) {
  console.log(usage);
  Deno.exit(0);
}

for (const mcp of mcps) {
  configOverrides.push(`mcp_servers.${mcp}.enabled=true`);
}

const args: string[] = [];
for (const override of configOverrides) {
  args.push("--config", override);
}
if (sandboxMode) {
  args.push("--sandbox", sandboxMode);
}
args.push(...passthrough);

const command = new Deno.Command("codex", {
  args,
  stdin: "inherit",
  stdout: "inherit",
  stderr: "inherit",
});
const child = command.spawn();
const status = await child.status;
Deno.exit(status.code);
