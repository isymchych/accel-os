import path from "node:path";

import type { CommandResult, RunCommandOptions } from "@accel-os/shared/process";

import type { ResolvedExternalTool, ResolvedHostState } from "./host-config.ts";

export type DoctorStatus = "pass" | "fail" | "skip";

export type DoctorResult = {
  id: string;
  status: DoctorStatus;
  summary: string;
  details?: readonly string[];
  remediation?: string;
};

export type FileMetadata = {
  uid: number;
  gid: number;
  mode: number;
  isFile: boolean;
  isSymbolicLink: boolean;
};

export type DoctorDependencies = {
  readText(path: string): Promise<string | null>;
  inspectPath(path: string): Promise<FileMetadata | null>;
  listFiles(path: string): Promise<readonly string[]>;
  isExecutable(path: string): Promise<boolean>;
  sha256File(path: string): Promise<string | null>;
  runCommand(command: string, args: string[], options?: RunCommandOptions): Promise<CommandResult>;
};

export type DoctorContext = {
  state: ResolvedHostState;
  externalTools: readonly ResolvedExternalTool[];
  repositoryRoot: string;
  homeDirectory: string;
  username: string;
  platform: NodeJS.Platform;
  environment: NodeJS.ProcessEnv;
};

const fixWithChezmoi = "Run: chezmoi apply";

function pass(id: string, summary: string): DoctorResult {
  return { id, status: "pass", summary };
}

function fail(
  id: string,
  summary: string,
  details: readonly string[],
  remediation = fixWithChezmoi,
): DoctorResult {
  return { id, status: "fail", summary, details, remediation };
}

function skip(id: string, summary: string, details?: readonly string[]): DoctorResult {
  return { id, status: "skip", summary, ...(details === undefined ? {} : { details }) };
}

function parseOsReleaseId(contents: string): string | null {
  for (const line of contents.split("\n")) {
    const match = /^ID=(?:"([^"]+)"|'([^']+)'|([^\s#]+))\s*$/u.exec(line);
    if (match !== null) {
      return match[1] ?? match[2] ?? match[3] ?? null;
    }
  }
  return null;
}

async function checkHost(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  if (context.platform !== "linux") {
    return fail(
      "host",
      `unsupported platform: ${context.platform}`,
      [],
      "Run on an Arch Linux host",
    );
  }

  const osRelease = await dependencies.readText("/etc/os-release");
  if (osRelease === null) {
    return fail("host", "cannot identify the operating system", ["/etc/os-release is missing"]);
  }

  const osId = parseOsReleaseId(osRelease);
  if (osId !== "arch") {
    return fail(
      "host",
      `unsupported Linux distribution: ${osId ?? "unknown"}`,
      [],
      "Run on Arch Linux",
    );
  }

  return pass(
    "host",
    `${context.state.hostname} (${String(context.state.features.length)} features)`,
  );
}

async function checkPackages(
  state: ResolvedHostState,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const result = await dependencies.runCommand("pacman", ["-Qq"]);
  if (!result.success) {
    return fail(
      "packages",
      "cannot query installed packages",
      [result.stderr || `pacman exited with status ${String(result.code)}`],
      "Repair pacman before running the doctor",
    );
  }

  const installed = new Set(result.stdout.split("\n").filter((name) => name !== ""));
  const missing = state.packages.filter((packageName) => !installed.has(packageName));
  if (missing.length > 0) {
    return fail(
      "packages",
      `${String(missing.length)} required package${missing.length === 1 ? " is" : "s are"} missing`,
      missing,
    );
  }

  return pass("packages", `${String(state.packages.length)} required packages installed`);
}

async function checkExternalTools(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const problems: string[] = [];

  for (const tool of context.externalTools) {
    const toolPath = path.join(context.homeDirectory, ".local", "bin", tool.binary);
    if (!(await dependencies.isExecutable(toolPath))) {
      problems.push(`${tool.name}: ${toolPath} is missing or not executable`);
      continue;
    }

    const actualSha256 = await dependencies.sha256File(toolPath);
    if (actualSha256 === null) {
      problems.push(`${tool.name}: ${toolPath} is missing`);
    } else if (actualSha256 !== tool.binarySha256) {
      problems.push(`${tool.name}: binary checksum differs from the pinned release`);
    }
  }

  if (problems.length > 0) {
    return fail("external-tools", `${String(problems.length)} external tool problem(s)`, problems);
  }

  return pass(
    "external-tools",
    `${String(context.externalTools.length)} pinned external tool${context.externalTools.length === 1 ? "" : "s"} installed`,
  );
}

async function checkUserAccount(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const problems: string[] = [];
  const requiredGroups = ["video", "wheel"];

  const passwd = await dependencies.runCommand("getent", ["passwd", context.username]);
  if (!passwd.success) {
    return fail(
      "user-account",
      `cannot inspect account ${context.username}`,
      [passwd.stderr || `getent exited with status ${String(passwd.code)}`],
      `Repair the account entry for ${context.username}`,
    );
  }

  const entries = passwd.stdout
    .trim()
    .split("\n")
    .filter((line) => line !== "");
  if (entries.length !== 1) {
    problems.push(
      `expected one passwd entry for ${context.username}, found ${String(entries.length)}`,
    );
  } else {
    const fields = entries[0]?.split(":") ?? [];
    const shell = fields[6];
    if (fields.length !== 7 || shell === undefined) {
      problems.push(`cannot parse passwd entry for ${context.username}`);
    } else if (shell !== "/bin/zsh") {
      problems.push(`default shell: expected /bin/zsh, found ${shell || "empty"}`);
    }
  }

  const groups = await dependencies.runCommand("id", ["-nG", context.username]);
  if (!groups.success) {
    problems.push(
      groups.stderr || `cannot query groups: id exited with status ${String(groups.code)}`,
    );
  } else {
    const memberships = new Set(
      groups.stdout
        .trim()
        .split(/\s+/u)
        .filter((group) => group !== ""),
    );
    for (const group of requiredGroups) {
      if (!memberships.has(group)) {
        problems.push(`missing required group: ${group}`);
      }
    }
  }

  if (problems.length > 0) {
    return fail(
      "user-account",
      `${String(problems.length)} account configuration problem(s)`,
      problems,
      `Run: sudo usermod --append --groups wheel,video ${context.username}; chsh -s /bin/zsh`,
    );
  }

  return pass("user-account", "/bin/zsh with wheel and video group membership");
}

function countPamRule(contents: string, expected: readonly string[]): number {
  return contents
    .split("\n")
    .map((line) => line.replace(/#.*/u, "").trim())
    .filter((line) => line !== "")
    .map((line) => line.split(/\s+/u))
    .filter(
      (fields) =>
        fields.length === expected.length &&
        fields.every((field, index) => field === expected[index]),
    ).length;
}

async function checkPamKeyring(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  if (!context.state.features.includes("sway")) {
    return skip("pam-keyring", "not required without the sway feature");
  }

  const filePath = "/etc/pam.d/greetd";
  const contents = await dependencies.readText(filePath);
  if (contents === null) {
    return fail(
      "pam-keyring",
      "greetd PAM configuration is missing",
      [filePath],
      `Configure GNOME Keyring integration in ${filePath}`,
    );
  }

  const problems: string[] = [];
  const rules = [
    ["auth", "optional", "pam_gnome_keyring.so"],
    ["session", "optional", "pam_gnome_keyring.so", "auto_start"],
  ] as const;
  for (const rule of rules) {
    const count = countPamRule(contents, rule);
    if (count !== 1) {
      problems.push(`expected exactly one ${rule.join(" ")} rule, found ${String(count)}`);
    }
  }

  if (problems.length > 0) {
    return fail(
      "pam-keyring",
      `${String(problems.length)} greetd PAM keyring problem(s)`,
      problems,
      `Configure GNOME Keyring integration in ${filePath}`,
    );
  }

  return pass("pam-keyring", "greetd unlocks and starts GNOME Keyring");
}

async function checkGcrSshAgent(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  if (!context.state.features.includes("sway")) {
    return skip("gcr-ssh-agent", "not required without the sway feature");
  }

  const problems: string[] = [];
  const socketUnit = "gcr-ssh-agent.socket";
  const enabled = await dependencies.runCommand("systemctl", ["--user", "is-enabled", socketUnit]);
  if (!enabled.success || enabled.stdout.trim() !== "enabled") {
    problems.push(`${socketUnit}: expected enabled, found ${enabled.stdout.trim() || "unknown"}`);
  }

  const active = await dependencies.runCommand("systemctl", ["--user", "is-active", socketUnit]);
  if (!active.success || active.stdout.trim() !== "active") {
    problems.push(`${socketUnit}: expected active, found ${active.stdout.trim() || "unknown"}`);
  }

  const runtimeDirectory = context.environment["XDG_RUNTIME_DIR"];
  if (runtimeDirectory === undefined || runtimeDirectory === "") {
    problems.push("XDG_RUNTIME_DIR is unset");
  } else {
    const expectedSocket = path.join(runtimeDirectory, "gcr/ssh");
    const actualSocket = context.environment["SSH_AUTH_SOCK"];
    if (actualSocket !== expectedSocket) {
      problems.push(`SSH_AUTH_SOCK: expected ${expectedSocket}, found ${actualSocket || "unset"}`);
    }
  }

  if (problems.length > 0) {
    return fail(
      "gcr-ssh-agent",
      `${String(problems.length)} SSH agent integration problem(s)`,
      problems,
      `Run: systemctl --user enable --now ${socketUnit}; then start a new Sway session`,
    );
  }

  return pass("gcr-ssh-agent", "socket enabled, active, and selected by SSH_AUTH_SOCK");
}

const runtimeActiveStates = new Set(["active", "activating", "deactivating", "reloading"]);

async function checkServiceScope(
  scope: "system" | "user",
  state: ResolvedHostState,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const id = `${scope}-services`;
  const systemctlArgs = scope === "user" ? ["--user"] : [];

  if (scope === "user") {
    const manager = await dependencies.runCommand("systemctl", ["--user", "show-environment"]);
    if (!manager.success) {
      return skip(id, "user systemd manager is unavailable", [
        manager.stderr || "systemctl --user show-environment failed",
      ]);
    }
  }

  const problems: string[] = [];
  for (const service of state.services[scope].enabled) {
    const enabled = await dependencies.runCommand("systemctl", [
      ...systemctlArgs,
      "is-enabled",
      service,
    ]);
    const enabledState = enabled.stdout.trim();
    if (!enabled.success || enabledState !== "enabled") {
      problems.push(`${service}: expected enabled, found ${enabledState || "unknown"}`);
    }

    const active = await dependencies.runCommand("systemctl", [
      ...systemctlArgs,
      "is-active",
      service,
    ]);
    const activeState = active.stdout.trim();
    if (!active.success || activeState !== "active") {
      problems.push(`${service}: expected active, found ${activeState || "unknown"}`);
    }
  }

  for (const service of state.services[scope].disabled) {
    const enabled = await dependencies.runCommand("systemctl", [
      ...systemctlArgs,
      "is-enabled",
      service,
    ]);
    const enabledState = enabled.stdout.trim();
    if (enabledState === "enabled" || enabledState === "enabled-runtime") {
      problems.push(`${service}: expected disabled, found ${enabledState}`);
    }

    const active = await dependencies.runCommand("systemctl", [
      ...systemctlArgs,
      "is-active",
      service,
    ]);
    const activeState = active.stdout.trim();
    if (active.success || runtimeActiveStates.has(activeState)) {
      problems.push(`${service}: expected inactive, found ${activeState || "unknown"}`);
    }
  }

  if (problems.length > 0) {
    return fail(id, `${String(problems.length)} service state problem(s)`, problems);
  }

  return pass(
    id,
    `${String(state.services[scope].enabled.length)} enabled, ${String(state.services[scope].disabled.length)} disabled`,
  );
}

function requireExactFile(
  problems: string[],
  filePath: string,
  contents: string | null,
  expected: string,
): void {
  if (contents === null) {
    problems.push(`${filePath}: missing`);
    return;
  }

  if (contents !== expected) {
    problems.push(`${filePath}: contents differ from managed configuration`);
  }
}

function requireUniqueLine(
  problems: string[],
  filePath: string,
  contents: string | null,
  pattern: RegExp,
  expected: string,
): void {
  if (contents === null) {
    problems.push(`${filePath}: missing`);
    return;
  }

  const matches = contents.split("\n").filter((line) => pattern.test(line));
  if (matches.length !== 1 || matches[0] !== expected) {
    problems.push(`${filePath}: expected exactly one ${JSON.stringify(expected)} entry`);
  }
}

function checkConsoleFont(problems: string[], contents: string | null, enabled: boolean): void {
  const filePath = "/etc/vconsole.conf";
  const begin = "# BEGIN accel-os console font";
  const end = "# END accel-os console font";
  if (!enabled) {
    if (contents?.includes(begin) === true || contents?.includes(end) === true) {
      problems.push(`${filePath}: stale managed console font block`);
    }
    return;
  }

  if (contents === null) {
    problems.push(`${filePath}: missing`);
    return;
  }

  const lines = contents.split("\n");
  const beginIndexes = lines.flatMap((line, index) => (line === begin ? [index] : []));
  const endIndexes = lines.flatMap((line, index) => (line === end ? [index] : []));
  const fontIndexes = lines.flatMap((line, index) => (/^\s*FONT=/u.test(line) ? [index] : []));
  const beginIndex = beginIndexes[0];
  if (
    beginIndexes.length !== 1 ||
    endIndexes.length !== 1 ||
    fontIndexes.length !== 1 ||
    beginIndex === undefined ||
    lines[beginIndex + 1] !== "FONT=ter-124n" ||
    lines[beginIndex + 2] !== end ||
    fontIndexes[0] !== beginIndex + 1
  ) {
    problems.push(`${filePath}: managed console font block is invalid`);
  }
}

function requireRootFile(
  problems: string[],
  filePath: string,
  metadata: FileMetadata | null,
  expectedMode: number,
): void {
  if (metadata === null) {
    problems.push(`${filePath}: cannot inspect file metadata`);
    return;
  }
  if (!metadata.isFile || metadata.isSymbolicLink) {
    problems.push(`${filePath}: expected a regular non-symlink file`);
  }
  if (metadata.uid !== 0 || metadata.gid !== 0) {
    problems.push(`${filePath}: expected root:root ownership`);
  }
  const mode = metadata.mode % 0o10000;
  if (mode !== expectedMode) {
    problems.push(
      `${filePath}: expected mode ${expectedMode.toString(8).padStart(4, "0")}, found ${mode.toString(8).padStart(4, "0")}`,
    );
  }
}

async function checkManagedConfiguration(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const problems: string[] = [];
  const features = new Set(context.state.features);
  const logindPath = "/etc/systemd/logind.conf.d/80-accel-os.conf";
  const sysctlPath = "/etc/sysctl.d/80-accel-os.conf";

  requireExactFile(
    problems,
    logindPath,
    await dependencies.readText(logindPath),
    "# Managed by accel-os.\n[Login]\nKillUserProcesses=yes\nHandlePowerKey=suspend\n",
  );
  requireExactFile(
    problems,
    sysctlPath,
    await dependencies.readText(sysctlPath),
    "# Managed by accel-os.\nvm.swappiness = 10\n",
  );

  const expectedHosts = features.has("printing")
    ? "hosts: mymachines files myhostname mdns_minimal [NOTFOUND=return] dns"
    : "hosts: mymachines files myhostname dns";
  requireUniqueLine(
    problems,
    "/etc/nsswitch.conf",
    await dependencies.readText("/etc/nsswitch.conf"),
    /^\s*hosts:/u,
    expectedHosts,
  );

  checkConsoleFont(
    problems,
    await dependencies.readText("/etc/vconsole.conf"),
    features.has("workstation"),
  );

  const launcherPath = "/usr/local/bin/run-sway.sh";
  const greetdPath = "/etc/greetd/config.toml";
  const managedMarker = "# Managed by accel-os.";
  if (features.has("sway")) {
    const launcher = await dependencies.readText(launcherPath);
    requireExactFile(
      problems,
      launcherPath,
      launcher,
      '#!/usr/bin/env zsh\n# Managed by accel-os.\n\nsource "$HOME/.run-sway"\n',
    );
    if (launcher !== null) {
      requireRootFile(problems, launcherPath, await dependencies.inspectPath(launcherPath), 0o755);
    }

    const greetd = await dependencies.readText(greetdPath);
    let expectedGreetd =
      '# Managed by accel-os.\n\n[terminal]\nvt = 1\n\n[default_session]\ncommand = "agreety --cmd /usr/local/bin/run-sway.sh"\nuser = "greeter"\n';
    if (context.state.greetd?.autologin === true) {
      expectedGreetd += `\n[initial_session]\ncommand = "/usr/local/bin/run-sway.sh"\nuser = "${context.username}"\n`;
    }
    requireExactFile(problems, greetdPath, greetd, expectedGreetd);
    if (greetd !== null) {
      requireRootFile(problems, greetdPath, await dependencies.inspectPath(greetdPath), 0o644);
    }
  } else {
    const launcher = await dependencies.readText(launcherPath);
    if (launcher?.split("\n").includes(managedMarker) === true) {
      problems.push(`${launcherPath}: stale configuration for disabled sway feature`);
    }
    const greetd = await dependencies.readText(greetdPath);
    if (greetd?.split("\n").includes(managedMarker) === true) {
      problems.push(`${greetdPath}: stale configuration for disabled sway feature`);
    }
  }

  const caps2escPath = "/etc/interception/udevmon.d/caps-to-esc-and-ctrl.yaml";
  const caps2esc = await dependencies.readText(caps2escPath);
  if (features.has("caps2esc")) {
    requireExactFile(
      problems,
      caps2escPath,
      caps2esc,
      '- JOB: "intercept -g $DEVNODE | caps2esc -m 1 | uinput -d $DEVNODE"\n  DEVICE:\n    EVENTS:\n      EV_KEY: [KEY_CAPSLOCK, KEY_ESC]\n',
    );
  } else if (caps2esc !== null) {
    problems.push(`${caps2escPath}: stale configuration for disabled caps2esc feature`);
  }

  const tlpPath = "/etc/tlp.d/01-accel-os.conf";
  const tlp = await dependencies.readText(tlpPath);
  if (context.state.tlp !== undefined) {
    const { battery, start, stop } = context.state.tlp.chargeThresholds;
    requireExactFile(
      problems,
      tlpPath,
      tlp,
      `START_CHARGE_THRESH_${battery}=${String(start)}\nSTOP_CHARGE_THRESH_${battery}=${String(stop)}\n`,
    );
  } else if (tlp !== null) {
    problems.push(`${tlpPath}: stale configuration without host TLP thresholds`);
  }

  if (problems.length > 0) {
    return fail(
      "managed-config",
      `${String(problems.length)} managed configuration problem(s)`,
      problems,
    );
  }

  return pass("managed-config", "managed system configuration matches host features");
}

async function checkScriptRuntime(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult> {
  const problems: string[] = [];
  const sourceBin = path.join(context.repositoryRoot, "dotfiles/bin");
  const homeBin = path.join(context.homeDirectory, "bin");
  const wrappers = (await dependencies.listFiles(sourceBin))
    .filter((name) => name.startsWith("executable_mb-"))
    .map((name) => name.slice("executable_".length))
    .sort();

  for (const wrapper of wrappers) {
    const installedPath = path.join(homeBin, wrapper);
    if (!(await dependencies.isExecutable(installedPath))) {
      problems.push(`${installedPath}: missing or not executable`);
    }
  }

  const accelNode = path.join(homeBin, "accel-node");
  if (!(await dependencies.isExecutable(accelNode))) {
    problems.push(`${accelNode}: missing or not executable`);
  } else {
    const result = await dependencies.runCommand(accelNode, ["--version"], {
      env: { ...context.environment, ACCEL_OS: context.repositoryRoot },
    });
    if (!result.success) {
      problems.push(
        `${accelNode}: ${result.stderr || `exited with status ${String(result.code)}`}`,
      );
    }
  }

  if (problems.length > 0) {
    return fail("script-runtime", `${String(problems.length)} script runtime problem(s)`, problems);
  }

  return pass("script-runtime", `${String(wrappers.length)} mb-* commands and accel-node ready`);
}

async function protectCheck(id: string, run: () => Promise<DoctorResult>): Promise<DoctorResult> {
  try {
    return await run();
  } catch (error) {
    return fail(
      id,
      "check could not run",
      [error instanceof Error ? error.message : String(error)],
      "Resolve the reported error and rerun `just doctor`",
    );
  }
}

export async function runDoctor(
  context: DoctorContext,
  dependencies: DoctorDependencies,
): Promise<DoctorResult[]> {
  return Promise.all([
    protectCheck("host", async () => checkHost(context, dependencies)),
    protectCheck("packages", async () => checkPackages(context.state, dependencies)),
    protectCheck("external-tools", async () => checkExternalTools(context, dependencies)),
    protectCheck("user-account", async () => checkUserAccount(context, dependencies)),
    protectCheck("system-services", async () =>
      checkServiceScope("system", context.state, dependencies),
    ),
    protectCheck("user-services", async () =>
      checkServiceScope("user", context.state, dependencies),
    ),
    protectCheck("managed-config", async () => checkManagedConfiguration(context, dependencies)),
    protectCheck("pam-keyring", async () => checkPamKeyring(context, dependencies)),
    protectCheck("gcr-ssh-agent", async () => checkGcrSshAgent(context, dependencies)),
    protectCheck("script-runtime", async () => checkScriptRuntime(context, dependencies)),
  ]);
}

export function formatDoctorResults(results: readonly DoctorResult[]): string {
  const lines: string[] = [];
  const labels: Record<DoctorStatus, string> = {
    pass: "PASS",
    fail: "FAIL",
    skip: "SKIP",
  };

  for (const result of results) {
    lines.push(`${labels[result.status]} ${result.id}: ${result.summary}`);
    for (const detail of result.details ?? []) {
      lines.push(`     ${detail}`);
    }
    if (result.remediation !== undefined) {
      lines.push(`     ${result.remediation}`);
    }
  }

  const counts = {
    pass: results.filter((result) => result.status === "pass").length,
    skip: results.filter((result) => result.status === "skip").length,
    fail: results.filter((result) => result.status === "fail").length,
  };
  lines.push(
    "",
    `${String(counts.pass)} passed, ${String(counts.skip)} skipped, ${String(counts.fail)} failed`,
  );
  return `${lines.join("\n")}\n`;
}
