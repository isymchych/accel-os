import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { assertSchema } from "@accel-os/shared/json";
import { Type, type Static, type TSchema } from "typebox";
import { parseDocument } from "yaml";

const stringListSchema = Type.Array(Type.String({ minLength: 1 }));
const packageGroupsSchema = Type.Record(Type.String(), stringListSchema);
const packageFeaturesSchema = Type.Record(Type.String(), packageGroupsSchema);
const packageProviderSchema = Type.Object(
  {
    base: packageGroupsSchema,
    features: packageFeaturesSchema,
  },
  { additionalProperties: false },
);
const sha256Schema = Type.String({ pattern: "^[a-f0-9]{64}$" });
const externalToolSchema = Type.Object(
  {
    name: Type.String({ pattern: "^[a-z0-9][a-z0-9-]*$" }),
    url: Type.String({ pattern: "^https://[^\\t\\n]+\\.tar\\.gz$" }),
    archive_sha256: sha256Schema,
    binary: Type.String({ pattern: "^[A-Za-z0-9][A-Za-z0-9._-]*$" }),
    binary_sha256: sha256Schema,
  },
  { additionalProperties: false },
);
const externalToolGroupsSchema = Type.Record(Type.String(), Type.Array(externalToolSchema));
const externalToolFeaturesSchema = Type.Record(Type.String(), externalToolGroupsSchema);
const externalToolsSchema = Type.Object(
  {
    linux: Type.Object(
      {
        arch: Type.Object(
          {
            github_release: Type.Object(
              {
                base: externalToolGroupsSchema,
                features: externalToolFeaturesSchema,
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);
const packagesSchema = Type.Object(
  {
    packages: Type.Object(
      {
        linux: Type.Object(
          {
            arch: Type.Object(
              {
                pacman: packageProviderSchema,
                aur: packageProviderSchema,
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
    external_tools: externalToolsSchema,
  },
  { additionalProperties: false },
);

const serviceStateSchema = Type.Object(
  {
    enabled: stringListSchema,
    disabled: Type.Optional(stringListSchema),
  },
  { additionalProperties: false },
);
const serviceScopesSchema = Type.Object(
  {
    system: serviceStateSchema,
    user: serviceStateSchema,
  },
  { additionalProperties: false },
);
const servicesSchema = Type.Object(
  {
    services: Type.Object(
      {
        linux: Type.Object(
          {
            arch: Type.Object(
              {
                base: serviceScopesSchema,
                features: Type.Record(Type.String(), serviceScopesSchema),
              },
              { additionalProperties: false },
            ),
          },
          { additionalProperties: false },
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

const hostSchema = Type.Object(
  {
    features: stringListSchema,
    greetd: Type.Optional(
      Type.Object(
        {
          autologin: Type.Boolean(),
        },
        { additionalProperties: false },
      ),
    ),
  },
  { additionalProperties: false },
);
const hostsSchema = Type.Object(
  {
    hosts: Type.Record(Type.String(), hostSchema),
  },
  { additionalProperties: false },
);

const tlpSchema = Type.Object(
  {
    tlp: Type.Object(
      {
        hosts: Type.Record(
          Type.String(),
          Type.Object(
            {
              charge_thresholds: Type.Object(
                {
                  battery: Type.String({ minLength: 1 }),
                  start: Type.Integer({ minimum: 0, maximum: 100 }),
                  stop: Type.Integer({ minimum: 0, maximum: 100 }),
                },
                { additionalProperties: false },
              ),
            },
            { additionalProperties: false },
          ),
        ),
      },
      { additionalProperties: false },
    ),
  },
  { additionalProperties: false },
);

type PackagesData = Static<typeof packagesSchema>;
type ServicesData = Static<typeof servicesSchema>;
type HostsData = Static<typeof hostsSchema>;
type TlpData = Static<typeof tlpSchema>;

export type HostConfig = {
  packages: PackagesData;
  services: ServicesData;
  hosts: HostsData;
  tlp: TlpData;
};

export type HostConfigPaths = {
  packages: string;
  services: string;
  hosts: string;
  tlp: string;
};

export async function readRepositoryHostConfig(repositoryRoot: string): Promise<HostConfig> {
  const dataDirectory = join(repositoryRoot, "dotfiles/.chezmoidata");
  return readHostConfig({
    packages: join(dataDirectory, "packages.yaml"),
    services: join(dataDirectory, "services.yaml"),
    hosts: join(dataDirectory, "hosts.yaml"),
    tlp: join(dataDirectory, "tlp.yaml"),
  });
}

export type ResolvedHostState = {
  hostname: string;
  features: readonly string[];
  packages: readonly string[];
  services: {
    system: {
      enabled: readonly string[];
      disabled: readonly string[];
    };
    user: {
      enabled: readonly string[];
      disabled: readonly string[];
    };
  };
  greetd?: {
    autologin: boolean;
  };
  tlp?: {
    chargeThresholds: {
      battery: string;
      start: number;
      stop: number;
    };
  };
};

export type ResolvedExternalTool = {
  name: string;
  url: string;
  archiveSha256: string;
  binary: string;
  binarySha256: string;
};

type MutableResolvedHostState = {
  hostname?: string;
  knownHost?: boolean;
  features: string[];
  packages: string[];
  services: {
    system: {
      enabled: string[];
      disabled: string[];
    };
    user: {
      enabled: string[];
      disabled: string[];
    };
  };
  greetd?: {
    autologin: boolean;
  };
  tlp?: {
    chargeThresholds: {
      battery: string;
      start: number;
      stop: number;
    };
  };
};

type Declaration = {
  value: string;
  path: string;
};

async function readYamlWithSchema<T extends TSchema>(path: string, schema: T): Promise<Static<T>> {
  const document = parseDocument(await readFile(path, "utf8"), { uniqueKeys: true });
  if (document.errors.length > 0) {
    throw new Error(
      `${path}: invalid YAML: ${document.errors.map((error) => error.message).join("; ")}`,
    );
  }

  const value: unknown = document.toJS();
  assertSchema(value, schema, path);
  return value;
}

export async function readHostConfig(paths: HostConfigPaths): Promise<HostConfig> {
  const [packages, services, hosts, tlp] = await Promise.all([
    readYamlWithSchema(paths.packages, packagesSchema),
    readYamlWithSchema(paths.services, servicesSchema),
    readYamlWithSchema(paths.hosts, hostsSchema),
    readYamlWithSchema(paths.tlp, tlpSchema),
  ]);

  return { packages, services, hosts, tlp };
}

function sortedUnique(values: readonly string[]): string[] {
  return [...new Set(values)].sort();
}

function parseBoolean(value: string, description: string): boolean {
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`${description} must be true or false`);
}

function parseInteger(value: string, description: string): number {
  if (!/^\d+$/u.test(value)) {
    throw new Error(`${description} must be an integer`);
  }
  return Number(value);
}

function parseHostRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 2 || state.hostname !== undefined) {
    throw new Error(`${location} must declare the host exactly once`);
  }
  state.hostname = fields[1] ?? "";
}

function parseKnownHostRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 2 || state.knownHost !== undefined) {
    throw new Error(`${location} must declare known_host exactly once`);
  }
  state.knownHost = parseBoolean(fields[1] ?? "", `${location} known_host`);
}

function parseFeatureRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 2) {
    throw new Error(`${location} has an invalid feature record`);
  }
  state.features.push(fields[1] ?? "");
}

function parsePackageRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 3 || (fields[1] !== "pacman" && fields[1] !== "aur")) {
    throw new Error(`${location} has an invalid package record`);
  }
  state.packages.push(fields[2] ?? "");
}

function parseServiceRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  const scope = fields[1];
  const desiredState = fields[2];
  if (
    fields.length !== 4 ||
    (scope !== "system" && scope !== "user") ||
    (desiredState !== "enabled" && desiredState !== "disabled")
  ) {
    throw new Error(`${location} has an invalid service record`);
  }
  state.services[scope][desiredState].push(fields[3] ?? "");
}

function parseGreetdRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 2 || state.greetd !== undefined) {
    throw new Error(`${location} has an invalid greetd record`);
  }
  state.greetd = {
    autologin: parseBoolean(fields[1] ?? "", `${location} greetd_autologin`),
  };
}

function parseTlpRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 4 || state.tlp !== undefined) {
    throw new Error(`${location} has an invalid TLP record`);
  }
  state.tlp = {
    chargeThresholds: {
      battery: fields[1] ?? "",
      start: parseInteger(fields[2] ?? "", `${location} TLP start threshold`),
      stop: parseInteger(fields[3] ?? "", `${location} TLP stop threshold`),
    },
  };
}

function parseExternalToolRecord(
  tools: ResolvedExternalTool[],
  fields: readonly string[],
  location: string,
): void {
  if (fields.length !== 6) {
    throw new Error(`${location} has an invalid external tool record`);
  }
  tools.push({
    name: fields[1] ?? "",
    url: fields[2] ?? "",
    archiveSha256: fields[3] ?? "",
    binary: fields[4] ?? "",
    binarySha256: fields[5] ?? "",
  });
}

function parseResolvedRecord(
  state: MutableResolvedHostState,
  fields: readonly string[],
  location: string,
): void {
  switch (fields[0]) {
    case "host":
      parseHostRecord(state, fields, location);
      break;
    case "known_host":
      parseKnownHostRecord(state, fields, location);
      break;
    case "feature":
      parseFeatureRecord(state, fields, location);
      break;
    case "package":
      parsePackageRecord(state, fields, location);
      break;
    case "service":
      parseServiceRecord(state, fields, location);
      break;
    case "greetd_autologin":
      parseGreetdRecord(state, fields, location);
      break;
    case "tlp":
      parseTlpRecord(state, fields, location);
      break;
    case undefined:
    default:
      throw new Error(`${location} has unknown record type ${JSON.stringify(fields[0])}`);
  }
}

export function parseResolvedHostState(contents: string): ResolvedHostState {
  const state: MutableResolvedHostState = {
    features: [],
    packages: [],
    services: {
      system: { enabled: [], disabled: [] },
      user: { enabled: [], disabled: [] },
    },
  };

  for (const [index, line] of contents.split("\n").entries()) {
    if (line === "") {
      continue;
    }

    const fields = line.split("\t");
    const location = `resolved host state line ${String(index + 1)}`;
    if (fields.some((field) => field === "")) {
      throw new Error(`${location} contains an empty field`);
    }

    parseResolvedRecord(state, fields, location);
  }

  if (state.hostname === undefined || state.knownHost === undefined) {
    throw new Error("Resolved host state must declare host and known_host");
  }

  return {
    hostname: state.hostname,
    features: sortedUnique(state.features),
    packages: sortedUnique(state.packages),
    services: {
      system: {
        enabled: sortedUnique(state.services.system.enabled),
        disabled: sortedUnique(state.services.system.disabled),
      },
      user: {
        enabled: sortedUnique(state.services.user.enabled),
        disabled: sortedUnique(state.services.user.disabled),
      },
    },
    ...(state.greetd === undefined ? {} : { greetd: state.greetd }),
    ...(state.tlp === undefined ? {} : { tlp: state.tlp }),
  };
}

export function parseResolvedExternalTools(contents: string): ResolvedExternalTool[] {
  const tools: ResolvedExternalTool[] = [];

  for (const [index, line] of contents.split("\n").entries()) {
    if (line === "") {
      continue;
    }

    const fields = line.split("\t");
    const location = `resolved external tools line ${String(index + 1)}`;
    if (fields.some((field) => field === "")) {
      throw new Error(`${location} contains an empty field`);
    }
    if (fields[0] !== "external_tool") {
      throw new Error(`${location} has unknown record type ${JSON.stringify(fields[0])}`);
    }

    parseExternalToolRecord(tools, fields, location);
  }

  return [...tools].sort((left, right) => left.name.localeCompare(right.name));
}

function findDuplicateDeclarations(
  declarations: readonly Declaration[],
  description: string,
): string[] {
  const pathsByValue = new Map<string, string[]>();
  for (const declaration of declarations) {
    const paths = pathsByValue.get(declaration.value) ?? [];
    paths.push(declaration.path);
    pathsByValue.set(declaration.value, paths);
  }

  return [...pathsByValue.entries()]
    .filter(([, paths]) => paths.length > 1)
    .map(
      ([value, paths]) =>
        `${description} ${JSON.stringify(value)} is declared more than once: ${paths.join(", ")}`,
    );
}

function collectPackages(config: HostConfig): {
  declarations: Declaration[];
  features: Set<string>;
} {
  const declarations: Declaration[] = [];
  const features = new Set<string>();
  const providers = config.packages.packages.linux.arch;

  for (const providerName of ["pacman", "aur"] as const) {
    const provider = providers[providerName];
    for (const [group, packages] of Object.entries(provider.base)) {
      for (const packageName of packages) {
        declarations.push({
          value: packageName,
          path: `packages.${providerName}.base.${group}`,
        });
      }
    }

    for (const [feature, groups] of Object.entries(provider.features)) {
      features.add(feature);
      for (const [group, packages] of Object.entries(groups)) {
        for (const packageName of packages) {
          declarations.push({
            value: packageName,
            path: `packages.${providerName}.features.${feature}.${group}`,
          });
        }
      }
    }
  }

  return { declarations, features };
}

function collectExternalTools(config: HostConfig): {
  names: Declaration[];
  binaries: Declaration[];
  features: Set<string>;
} {
  const names: Declaration[] = [];
  const binaries: Declaration[] = [];
  const features = new Set<string>();
  const tools = config.packages.external_tools.linux.arch.github_release;

  for (const [group, groupTools] of Object.entries(tools.base)) {
    for (const [index, tool] of groupTools.entries()) {
      const path = `external_tools.github_release.base.${group}[${String(index)}]`;
      names.push({ value: tool.name, path: `${path}.name` });
      binaries.push({ value: tool.binary, path: `${path}.binary` });
    }
  }

  for (const [feature, groups] of Object.entries(tools.features)) {
    features.add(feature);
    for (const [group, groupTools] of Object.entries(groups)) {
      for (const [index, tool] of groupTools.entries()) {
        const path = `external_tools.github_release.features.${feature}.${group}[${String(index)}]`;
        names.push({ value: tool.name, path: `${path}.name` });
        binaries.push({ value: tool.binary, path: `${path}.binary` });
      }
    }
  }

  return { names, binaries, features };
}

function collectServices(config: HostConfig): {
  enabled: Record<"system" | "user", Declaration[]>;
  disabled: Record<"system" | "user", Declaration[]>;
  features: Set<string>;
} {
  const enabled = { system: [] as Declaration[], user: [] as Declaration[] };
  const disabled = { system: [] as Declaration[], user: [] as Declaration[] };
  const features = new Set<string>();
  const services = config.services.services.linux.arch;

  const collectScopes = (owner: string, scopes: typeof services.base): void => {
    for (const scope of ["system", "user"] as const) {
      for (const service of scopes[scope].enabled) {
        enabled[scope].push({ value: service, path: `${owner}.${scope}.enabled` });
      }
      for (const service of scopes[scope].disabled ?? []) {
        disabled[scope].push({ value: service, path: `${owner}.${scope}.disabled` });
      }
    }
  };

  collectScopes("services.base", services.base);
  for (const [feature, scopes] of Object.entries(services.features)) {
    features.add(feature);
    collectScopes(`services.features.${feature}`, scopes);
  }

  return { enabled, disabled, features };
}

export function validateHostConfig(config: HostConfig): string[] {
  const errors: string[] = [];
  const packages = collectPackages(config);
  const externalTools = collectExternalTools(config);
  const services = collectServices(config);
  const knownFeatures = new Set([
    ...packages.features,
    ...externalTools.features,
    ...services.features,
  ]);
  const hosts = config.hosts.hosts;

  errors.push(...findDuplicateDeclarations(packages.declarations, "Package"));
  errors.push(...findDuplicateDeclarations(externalTools.names, "External tool"));
  errors.push(...findDuplicateDeclarations(externalTools.binaries, "External tool binary"));

  for (const scope of ["system", "user"] as const) {
    const enabled = new Map(
      services.enabled[scope].map((declaration) => [declaration.value, declaration.path]),
    );
    for (const declaration of services.disabled[scope]) {
      const enabledPath = enabled.get(declaration.value);
      if (enabledPath !== undefined) {
        errors.push(
          `${scope} service ${JSON.stringify(declaration.value)} is both enabled (${enabledPath}) and disabled (${declaration.path})`,
        );
      }
    }
  }

  for (const [hostname, host] of Object.entries(hosts)) {
    const featureDeclarations = host.features.map((feature) => ({
      value: feature,
      path: `hosts.${hostname}.features`,
    }));
    errors.push(
      ...findDuplicateDeclarations(featureDeclarations, `Host ${JSON.stringify(hostname)} feature`),
    );

    for (const feature of host.features) {
      if (!knownFeatures.has(feature)) {
        errors.push(
          `Host ${JSON.stringify(hostname)} uses unknown feature ${JSON.stringify(feature)}`,
        );
      }
    }

    if (host.greetd !== undefined && !host.features.includes("sway")) {
      errors.push(`Host ${JSON.stringify(hostname)} configures greetd without the sway feature`);
    }
  }

  for (const [hostname, tlp] of Object.entries(config.tlp.tlp.hosts)) {
    const host = hosts[hostname];
    if (host === undefined) {
      errors.push(`TLP configuration references unknown host ${JSON.stringify(hostname)}`);
      continue;
    }
    if (!host.features.includes("laptop")) {
      errors.push(`Host ${JSON.stringify(hostname)} configures TLP without the laptop feature`);
    }
    if (tlp.charge_thresholds.start >= tlp.charge_thresholds.stop) {
      errors.push(
        `Host ${JSON.stringify(hostname)} TLP start threshold must be lower than its stop threshold`,
      );
    }
  }

  return errors.sort();
}
