import type { WorkspaceApi } from "../desktop-api.ts";
import type { DesktopWorkspace } from "./workspace.ts";

/** Application operations independent of the desktop transport. */
export function workspaceApi(workspace: DesktopWorkspace): WorkspaceApi {
  return {
    // The asynchronous contract is shared with transport-backed clients.
    // oxlint-disable-next-line typescript/require-await
    workspace: async () => workspace.snapshot(),
    list: async (cwd) => workspace.list(cwd),
    create: async (cwd) => workspace.create(cwd),
    open: async (cwd, path) => workspace.open(cwd, path),
    // oxlint-disable-next-line typescript/require-await
    snapshot: async (key) => workspace.session(key).snapshot(),
    prompt: async ({ key, message, mode }) => {
      if (message.trim().length === 0)
        throw new Error("Enter a message of at most 100,000 characters.");
      return workspace.session(key).prompt(message, mode);
    },
    stop: async (key) => workspace.session(key).stop(),
    history: async (key) => workspace.session(key).history(),
    navigate: async (key, entryId) => workspace.session(key).navigate(entryId),
    fork: async (key, entryId) => workspace.fork(key, entryId),
    controls: async (key) => workspace.session(key).controls(),
    model: async (key, provider, modelId) => workspace.session(key).model(provider, modelId),
    thinking: async (key, level) => workspace.session(key).thinking(level),
    subscribe: (listener) => workspace.subscribe(listener),
  };
}
