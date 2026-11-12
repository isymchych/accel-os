import path from "node:path";

import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
} from "@earendil-works/pi-coding-agent";
import { Effect } from "effect";

export interface PiSessionOptions {
  cwd: string;
  agentDir: string;
  profileDir: string;
  sessionDir: string;
  sharedDir: string;
  sessionFile?: string;
}
export type PiSessionFactory = (options: PiSessionOptions) => Promise<AgentSession>;

/** Dispose an already stopped SDK session and finish its credential writes, even on failure. */
export function disposePiSession(session: AgentSession): Effect.Effect<void> {
  return Effect.sync(() => {
    session.dispose();
  }).pipe(Effect.ensuring(Effect.promise(() => session.modelRuntime.settleCredentialWrites())));
}

/** Pagoda's explicit SDK configuration, independent of the terminal launcher. */
export const createPiSession: PiSessionFactory = async (options) => {
  const settings = SettingsManager.inMemory();
  const resources = new DefaultResourceLoader({
    cwd: options.cwd,
    agentDir: options.agentDir,
    settingsManager: settings,
    noExtensions: true,
    additionalSkillPaths: [path.join(options.sharedDir, "skills")],
    additionalPromptTemplatePaths: [path.join(options.sharedDir, "prompts")],
    appendSystemPrompt: [path.join(options.sharedDir, "SYSTEM.md")],
  });
  await resources.reload();
  const modelRuntime = await ModelRuntime.create({
    authPath: path.join(options.profileDir, "auth.json"),
    modelsPath: path.join(options.agentDir, "models.json"),
    allowModelNetwork: false,
  });
  const sessionManager = options.sessionFile
    ? SessionManager.open(options.sessionFile, options.sessionDir, options.cwd)
    : SessionManager.create(options.cwd, options.sessionDir);
  const { session } = await createAgentSession({
    cwd: options.cwd,
    agentDir: options.agentDir,
    modelRuntime,
    settingsManager: settings,
    resourceLoader: resources,
    sessionManager,
    tools: ["read", "bash", "edit", "write"],
  });
  return session;
};
