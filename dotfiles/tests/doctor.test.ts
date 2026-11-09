import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import type { CommandResult } from "@accel-os/shared/process";

import {
  formatDoctorResults,
  runDoctor,
  type DoctorContext,
  type DoctorDependencies,
} from "../scripts/lib/doctor.ts";
import {
  parseResolvedExternalTools,
  parseResolvedHostState,
  readHostConfig,
  type ResolvedHostState,
  validateHostConfig,
} from "../scripts/lib/host-config.ts";

const scriptsDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptsDirectory, "../..");

function commandResult(code: number, stdout = "", stderr = ""): CommandResult {
  return { code, stdout, stderr, success: code === 0 };
}

const state: ResolvedHostState = {
  hostname: "test-host",
  features: [],
  packages: ["base-package"],
  services: {
    system: {
      enabled: ["required.service"],
      disabled: ["conflicting.service"],
    },
    user: {
      enabled: ["required-user.service"],
      disabled: [],
    },
  },
};

const context: DoctorContext = {
  state,
  externalTools: [],
  repositoryRoot: "/repo",
  homeDirectory: "/home/test",
  username: "test",
  platform: "linux",
  environment: {},
};

const validFiles = new Map([
  ["/etc/os-release", "NAME=Arch Linux\nID=arch\n"],
  [
    "/etc/systemd/logind.conf.d/80-accel-os.conf",
    "# Managed by accel-os.\n[Login]\nKillUserProcesses=yes\nHandlePowerKey=suspend\n",
  ],
  ["/etc/sysctl.d/80-accel-os.conf", "# Managed by accel-os.\nvm.swappiness = 10\n"],
  ["/etc/nsswitch.conf", "passwd: files\nhosts: mymachines files myhostname dns\n"],
]);

test("parseResolvedHostState reads the canonical resolved state", () => {
  assert.deepEqual(
    parseResolvedHostState(`host\ttest-host
known_host\ttrue
feature\tselected
package\tpacman\tbase-package
package\taur\tselected-package
service\tsystem\tenabled\tbase.service
service\tsystem\tenabled\tselected.service
service\tsystem\tdisabled\tdisabled.service
service\tsystem\tdisabled\tselected-disabled.service
service\tsystem\tdisabled\tunselected.service
service\tuser\tenabled\tselected-user.service
service\tuser\tdisabled\tdisabled-user.service
service\tuser\tdisabled\tunselected-user.service
greetd_autologin\tfalse
tlp\tBAT0\t75\t80
`),
    {
      hostname: "test-host",
      features: ["selected"],
      packages: ["base-package", "selected-package"],
      services: {
        system: {
          enabled: ["base.service", "selected.service"],
          disabled: ["disabled.service", "selected-disabled.service", "unselected.service"],
        },
        user: {
          enabled: ["selected-user.service"],
          disabled: ["disabled-user.service", "unselected-user.service"],
        },
      },
      greetd: { autologin: false },
      tlp: {
        chargeThresholds: {
          battery: "BAT0",
          start: 75,
          stop: 80,
        },
      },
    },
  );
});

test("parseResolvedHostState reads an undeclared host baseline", () => {
  assert.deepEqual(
    parseResolvedHostState(`host\tundeclared-host
known_host\tfalse
package\tpacman\tbase-package
service\tsystem\tenabled\tbase.service
service\tsystem\tdisabled\tbase-disabled.service
service\tuser\tdisabled\tbase-disabled-user.service
`),
    {
      hostname: "undeclared-host",
      features: [],
      packages: ["base-package"],
      services: {
        system: {
          enabled: ["base.service"],
          disabled: ["base-disabled.service"],
        },
        user: {
          enabled: [],
          disabled: ["base-disabled-user.service"],
        },
      },
    },
  );
});

test("parseResolvedExternalTools reads the canonical external-tool state", () => {
  assert.deepEqual(
    parseResolvedExternalTools(
      "external_tool\tsnip\thttps://example.com/snip.tar.gz\t1111111111111111111111111111111111111111111111111111111111111111\tsnip\t2222222222222222222222222222222222222222222222222222222222222222\n",
    ),
    [
      {
        name: "snip",
        url: "https://example.com/snip.tar.gz",
        archiveSha256: "1111111111111111111111111111111111111111111111111111111111111111",
        binary: "snip",
        binarySha256: "2222222222222222222222222222222222222222222222222222222222222222",
      },
    ],
  );
});

test("validateHostConfig rejects external tools that install the same binary", async () => {
  const dataDirectory = path.join(repositoryRoot, "dotfiles/.chezmoidata");
  const config = await readHostConfig({
    packages: path.join(dataDirectory, "packages.yaml"),
    services: path.join(dataDirectory, "services.yaml"),
    hosts: path.join(dataDirectory, "hosts.yaml"),
    tlp: path.join(dataDirectory, "tlp.yaml"),
  });
  const tools = config.packages.external_tools.linux.arch.github_release.base["ai"];
  assert.ok(tools);
  const original = tools[0];
  assert.ok(original);
  tools.push({ ...original, name: "another-snip" });

  assert.deepEqual(validateHostConfig(config), [
    'External tool binary "snip" is declared more than once: external_tools.github_release.base.ai[0].binary, external_tools.github_release.base.ai[1].binary',
  ]);
});

function createDependencies(overrides: Partial<DoctorDependencies> = {}): DoctorDependencies {
  const dependencies: DoctorDependencies = {
    async readText(filePath) {
      return validFiles.get(filePath) ?? null;
    },
    async inspectPath(filePath) {
      return {
        uid: 0,
        gid: 0,
        mode: filePath === "/usr/local/bin/run-sway.sh" ? 0o100755 : 0o100644,
        isFile: true,
        isSymbolicLink: false,
      };
    },
    async listFiles(directory) {
      assert.equal(directory, "/repo/dotfiles/bin");
      return ["executable_mb-touchpad"];
    },
    async isExecutable(filePath) {
      return filePath === "/home/test/bin/mb-touchpad" || filePath === "/home/test/bin/accel-node";
    },
    async sha256File() {
      return null;
    },
    async runCommand(command, args) {
      if (command === "pacman") {
        return commandResult(0, "base-package");
      }
      if (command === "getent" && args.join(" ") === "passwd test") {
        return commandResult(0, "test:x:1000:1000::/home/test:/bin/zsh\n");
      }
      if (command === "id" && args.join(" ") === "-nG test") {
        return commandResult(0, "test video wheel\n");
      }
      if (command === "/home/test/bin/accel-node") {
        return commandResult(0, "v24.0.0");
      }
      if (command !== "systemctl") {
        throw new Error(`Unexpected command: ${command}`);
      }
      if (args.join(" ") === "--user show-environment") {
        return commandResult(0);
      }
      if (args.includes("is-active")) {
        const service = args.at(-1);
        if (service === "required.service" || service === "required-user.service") {
          return commandResult(0, "active");
        }
        if (service === "conflicting.service") {
          return commandResult(3, "inactive");
        }
      }
      const service = args.at(-1);
      if (service === "required.service" || service === "required-user.service") {
        return commandResult(0, "enabled");
      }
      if (service === "conflicting.service") {
        return commandResult(1, "disabled");
      }
      throw new Error(`Unexpected systemctl arguments: ${args.join(" ")}`);
    },
  };

  return { ...dependencies, ...overrides };
}

test("runDoctor passes when the declared host state is satisfied", async () => {
  const results = await runDoctor(context, createDependencies());

  assert.deepEqual(
    results.map(({ id, status }) => ({ id, status })),
    [
      { id: "host", status: "pass" },
      { id: "packages", status: "pass" },
      { id: "external-tools", status: "pass" },
      { id: "user-account", status: "pass" },
      { id: "system-services", status: "pass" },
      { id: "user-services", status: "pass" },
      { id: "managed-config", status: "pass" },
      { id: "pam-keyring", status: "skip" },
      { id: "gcr-ssh-agent", status: "skip" },
      { id: "script-runtime", status: "pass" },
    ],
  );
});

test("runDoctor aggregates missing packages and managed configuration drift", async () => {
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/etc/sysctl.d/80-accel-os.conf") {
        return null;
      }
      return validFiles.get(filePath) ?? null;
    },
    async runCommand(command, args, options) {
      if (command === "pacman") {
        return commandResult(0);
      }
      return createDependencies().runCommand(command, args, options);
    },
  });

  const results = await runDoctor(context, dependencies);
  const packages = results.find((result) => result.id === "packages");
  const managedConfig = results.find((result) => result.id === "managed-config");

  assert.ok(packages);
  assert.equal(packages.status, "fail");
  assert.deepEqual(packages.details, ["base-package"]);
  assert.ok(managedConfig);
  assert.equal(managedConfig.status, "fail");
  assert.match(managedConfig.details?.join("\n") ?? "", /80-accel-os\.conf: missing/u);
});

test("runDoctor verifies pinned external tools without executing them", async () => {
  const externalTool = {
    name: "snip",
    url: "https://example.com/snip.tar.gz",
    archiveSha256: "1".repeat(64),
    binary: "snip",
    binarySha256: "2".repeat(64),
  };
  const externalToolContext: DoctorContext = {
    ...context,
    externalTools: [externalTool],
  };
  const dependencies = createDependencies({
    async isExecutable(filePath) {
      return (
        filePath === "/home/test/.local/bin/snip" ||
        filePath === "/home/test/bin/mb-touchpad" ||
        filePath === "/home/test/bin/accel-node"
      );
    },
    async sha256File(filePath) {
      assert.equal(filePath, "/home/test/.local/bin/snip");
      return externalTool.binarySha256;
    },
  });

  const results = await runDoctor(externalToolContext, dependencies);

  assert.deepEqual(
    results.find((result) => result.id === "external-tools"),
    {
      id: "external-tools",
      status: "pass",
      summary: "1 pinned external tool installed",
    },
  );
});

test("runDoctor reports missing and modified external tools", async () => {
  const externalTools = [
    {
      name: "missing",
      url: "https://example.com/missing.tar.gz",
      archiveSha256: "1".repeat(64),
      binary: "missing",
      binarySha256: "2".repeat(64),
    },
    {
      name: "modified",
      url: "https://example.com/modified.tar.gz",
      archiveSha256: "3".repeat(64),
      binary: "modified",
      binarySha256: "4".repeat(64),
    },
  ];
  const externalToolContext: DoctorContext = {
    ...context,
    externalTools,
  };
  const dependencies = createDependencies({
    async isExecutable(filePath) {
      return (
        filePath === "/home/test/.local/bin/modified" ||
        filePath === "/home/test/bin/mb-touchpad" ||
        filePath === "/home/test/bin/accel-node"
      );
    },
    async sha256File(filePath) {
      assert.equal(filePath, "/home/test/.local/bin/modified");
      return "5".repeat(64);
    },
  });

  const results = await runDoctor(externalToolContext, dependencies);
  const externalToolsResult = results.find((result) => result.id === "external-tools");

  assert.ok(externalToolsResult);
  assert.equal(externalToolsResult.status, "fail");
  assert.deepEqual(externalToolsResult.details, [
    "missing: /home/test/.local/bin/missing is missing or not executable",
    "modified: binary checksum differs from the pinned release",
  ]);
});

test("runDoctor skips user services when the user manager is unavailable", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    async runCommand(command, args, options) {
      if (command === "systemctl" && args.join(" ") === "--user show-environment") {
        return commandResult(1, "", "Failed to connect to bus");
      }
      return base.runCommand(command, args, options);
    },
  });

  const results = await runDoctor(context, dependencies);
  const userServices = results.find((result) => result.id === "user-services");

  assert.ok(userServices);
  assert.equal(userServices.status, "skip");
  assert.deepEqual(userServices.details, ["Failed to connect to bus"]);
});

test("runDoctor checks persistent and runtime service state", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    async runCommand(command, args, options) {
      if (command === "systemctl" && args.at(-1) === "required.service") {
        if (args.includes("is-enabled")) {
          return commandResult(0, "enabled-runtime");
        }
        if (args.includes("is-active")) {
          return commandResult(3, "inactive");
        }
      }
      if (command === "systemctl" && args.at(-1) === "conflicting.service") {
        if (args.includes("is-enabled")) {
          return commandResult(1, "disabled");
        }
        if (args.includes("is-active")) {
          return commandResult(0, "active");
        }
      }
      return base.runCommand(command, args, options);
    },
  });

  const results = await runDoctor(context, dependencies);
  const systemServices = results.find((result) => result.id === "system-services");

  assert.ok(systemServices);
  assert.equal(systemServices.status, "fail");
  assert.deepEqual(systemServices.details, [
    "required.service: expected enabled, found enabled-runtime",
    "required.service: expected active, found inactive",
    "conflicting.service: expected inactive, found active",
  ]);
});

test("runDoctor rejects conflicting duplicate managed settings", async () => {
  const tlpContext: DoctorContext = {
    ...context,
    state: {
      ...state,
      tlp: {
        chargeThresholds: {
          battery: "BAT0",
          start: 75,
          stop: 80,
        },
      },
    },
  };
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/etc/tlp.d/01-accel-os.conf") {
        return [
          "START_CHARGE_THRESH_BAT0=75",
          "STOP_CHARGE_THRESH_BAT0=80",
          "STOP_CHARGE_THRESH_BAT0=100",
          "",
        ].join("\n");
      }
      return validFiles.get(filePath) ?? null;
    },
  });

  const results = await runDoctor(tlpContext, dependencies);
  const managedConfig = results.find((result) => result.id === "managed-config");

  assert.ok(managedConfig);
  assert.equal(managedConfig.status, "fail");
  assert.match(managedConfig.details?.join("\n") ?? "", /tlp.*contents differ/u);
});

test("runDoctor detects stale managed feature configuration", async () => {
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/etc/vconsole.conf") {
        return "# BEGIN accel-os console font\nFONT=ter-124n\n# END accel-os console font\n";
      }
      if (filePath === "/usr/local/bin/run-sway.sh") {
        return "#!/usr/bin/env zsh\n# Managed by accel-os.\n";
      }
      if (filePath === "/etc/greetd/config.toml") {
        return "# Managed by accel-os.\n";
      }
      return validFiles.get(filePath) ?? null;
    },
  });

  const results = await runDoctor(context, dependencies);
  const managedConfig = results.find((result) => result.id === "managed-config");
  const details = managedConfig?.details?.join("\n") ?? "";

  assert.ok(managedConfig);
  assert.equal(managedConfig.status, "fail");
  assert.match(details, /stale managed console font block/u);
  assert.match(details, /run-sway\.sh: stale configuration/u);
  assert.match(details, /greetd\/config\.toml: stale configuration/u);
});

test("runDoctor verifies the greetd configuration and file metadata", async () => {
  const swayContext: DoctorContext = {
    ...context,
    state: {
      ...state,
      features: ["sway"],
      greetd: { autologin: true },
    },
  };
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/usr/local/bin/run-sway.sh") {
        return '#!/usr/bin/env zsh\n# Managed by accel-os.\n\nsource "$HOME/.run-sway"\n';
      }
      if (filePath === "/etc/greetd/config.toml") {
        return [
          "# Managed by accel-os.",
          "",
          "[terminal]",
          "vt = 1",
          "",
          "[default_session]",
          'command = "agreety --cmd /usr/local/bin/run-sway.sh"',
          'user = "greeter"',
          "",
          "[initial_session]",
          'command = "/usr/local/bin/wrong-session.sh"',
          'user = "test"',
          "",
        ].join("\n");
      }
      return validFiles.get(filePath) ?? null;
    },
    async inspectPath(filePath) {
      if (filePath === "/usr/local/bin/run-sway.sh") {
        return {
          uid: 1000,
          gid: 1000,
          mode: 0o100777,
          isFile: true,
          isSymbolicLink: false,
        };
      }
      return {
        uid: 0,
        gid: 0,
        mode: 0o100644,
        isFile: true,
        isSymbolicLink: false,
      };
    },
  });

  const results = await runDoctor(swayContext, dependencies);
  const managedConfig = results.find((result) => result.id === "managed-config");
  const details = managedConfig?.details?.join("\n") ?? "";

  assert.ok(managedConfig);
  assert.equal(managedConfig.status, "fail");
  assert.match(details, /greetd\/config\.toml: contents differ/u);
  assert.match(details, /run-sway\.sh: expected root:root ownership/u);
  assert.match(details, /run-sway\.sh: expected mode 0755, found 0777/u);
});

test("runDoctor reports user account drift", async () => {
  const base = createDependencies();
  const dependencies = createDependencies({
    async runCommand(command, args, options) {
      if (command === "getent") {
        return commandResult(0, "test:x:1000:1000::/home/test:/bin/bash\n");
      }
      if (command === "id") {
        return commandResult(0, "test wheel\n");
      }
      return base.runCommand(command, args, options);
    },
  });

  const results = await runDoctor(context, dependencies);
  const account = results.find((result) => result.id === "user-account");

  assert.ok(account);
  assert.equal(account.status, "fail");
  assert.deepEqual(account.details, [
    "default shell: expected /bin/zsh, found /bin/bash",
    "missing required group: video",
  ]);
});

test("runDoctor verifies Sway keyring and SSH agent integration", async () => {
  const swayContext: DoctorContext = {
    ...context,
    state: { ...state, features: ["sway"] },
    environment: {
      XDG_RUNTIME_DIR: "/run/user/1000",
      SSH_AUTH_SOCK: "/run/user/1000/gcr/ssh",
    },
  };
  const base = createDependencies();
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/etc/pam.d/greetd") {
        return [
          "#%PAM-1.0",
          "auth optional pam_gnome_keyring.so",
          "session optional pam_gnome_keyring.so auto_start",
          "",
        ].join("\n");
      }
      return validFiles.get(filePath) ?? null;
    },
    async runCommand(command, args, options) {
      if (command === "systemctl" && args.at(-1) === "gcr-ssh-agent.socket") {
        if (args.includes("is-enabled")) {
          return commandResult(0, "enabled\n");
        }
        if (args.includes("is-active")) {
          return commandResult(0, "active\n");
        }
      }
      return base.runCommand(command, args, options);
    },
  });

  const results = await runDoctor(swayContext, dependencies);

  assert.equal(results.find((result) => result.id === "pam-keyring")?.status, "pass");
  assert.equal(results.find((result) => result.id === "gcr-ssh-agent")?.status, "pass");
});

test("runDoctor reports incomplete Sway keyring and SSH agent integration", async () => {
  const swayContext: DoctorContext = {
    ...context,
    state: { ...state, features: ["sway"] },
    environment: {
      XDG_RUNTIME_DIR: "/run/user/1000",
      SSH_AUTH_SOCK: "/tmp/other-agent",
    },
  };
  const base = createDependencies();
  const dependencies = createDependencies({
    async readText(filePath) {
      if (filePath === "/etc/pam.d/greetd") {
        return "auth optional pam_gnome_keyring.so\n";
      }
      return validFiles.get(filePath) ?? null;
    },
    async runCommand(command, args, options) {
      if (command === "systemctl" && args.at(-1) === "gcr-ssh-agent.socket") {
        if (args.includes("is-enabled")) {
          return commandResult(1, "disabled\n");
        }
        if (args.includes("is-active")) {
          return commandResult(3, "inactive\n");
        }
      }
      return base.runCommand(command, args, options);
    },
  });

  const results = await runDoctor(swayContext, dependencies);
  const pam = results.find((result) => result.id === "pam-keyring");
  const agent = results.find((result) => result.id === "gcr-ssh-agent");

  assert.ok(pam);
  assert.equal(pam.status, "fail");
  assert.match(pam.details?.join("\n") ?? "", /session optional pam_gnome_keyring/u);
  assert.ok(agent);
  assert.equal(agent.status, "fail");
  assert.deepEqual(agent.details, [
    "gcr-ssh-agent.socket: expected enabled, found disabled",
    "gcr-ssh-agent.socket: expected active, found inactive",
    "SSH_AUTH_SOCK: expected /run/user/1000/gcr/ssh, found /tmp/other-agent",
  ]);
});

test("formatDoctorResults includes details, remediation, and totals", () => {
  const output = formatDoctorResults([
    { id: "host", status: "pass", summary: "test-host" },
    {
      id: "packages",
      status: "fail",
      summary: "one missing",
      details: ["missing-package"],
      remediation: "Run: chezmoi apply",
    },
    { id: "user-services", status: "skip", summary: "manager unavailable" },
  ]);

  assert.match(output, /^PASS host: test-host/mu);
  assert.match(output, /^FAIL packages: one missing/mu);
  assert.match(output, /^ {5}missing-package$/mu);
  assert.match(output, /1 passed, 1 skipped, 1 failed\n$/u);
});
