import { RegistryContext, useAtomMount } from "@effect/atom-react";
import {
  createContext,
  createElement,
  useContext,
  useMemo,
  type ReactElement,
  type ReactNode,
} from "react";

import type { WorkspaceApi } from "../contracts/index.ts";
import { createComposerAtoms, type ComposerAtoms } from "./composer-atoms.ts";
import type { RequestAtoms } from "./request-atoms.ts";
import { createWorkspaceAtoms, type WorkspaceAtoms } from "./workspace-atoms.ts";

const ApiContext = createContext<Pick<WorkspaceApi, "subscribe"> | null>(null);
const RequestsContext = createContext<RequestAtoms | null>(null);
const WorkspaceContext = createContext<WorkspaceAtoms | null>(null);
const ComposerContext = createContext<ComposerAtoms | null>(null);

function WorkspaceProvider({
  api,
  requests,
  children,
}: {
  api: Pick<WorkspaceApi, "subscribe">;
  requests: RequestAtoms;
  children?: ReactNode;
}): ReactElement {
  const workspace = useMemo(() => createWorkspaceAtoms(api, requests), [api, requests]);
  const composers = useMemo(
    () => createComposerAtoms(sessionStorage, requests.promptEffect),
    [requests],
  );
  useAtomMount(workspace.subscription);
  return createElement(
    WorkspaceContext.Provider,
    { value: workspace },
    createElement(ComposerContext.Provider, { value: composers }, children),
  );
}

export function useComposerAtoms(): ComposerAtoms {
  const composers = useContext(ComposerContext);
  if (!composers) throw new Error("Application composers are unavailable");
  return composers;
}

export function ApiProvider({
  api,
  requests,
  children,
}: {
  api: Pick<WorkspaceApi, "subscribe">;
  requests: RequestAtoms;
  children: ReactNode;
}): ReactElement {
  return createElement(
    ApiContext.Provider,
    { value: api },
    createElement(
      RequestsContext.Provider,
      { value: requests },
      createElement(WorkspaceProvider, { api, requests }, children),
    ),
  );
}

export function useWorkspaceAtoms(): WorkspaceAtoms {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error("Application workspace is unavailable");
  return workspace;
}

export function useApi(): WorkspaceApi {
  const api = useContext(ApiContext);
  const requests = useContext(RequestsContext);
  const registry = useContext(RegistryContext);
  if (!api) throw new Error("Application API is unavailable");
  if (!requests) throw new Error("Application request state is unavailable");
  return useMemo(() => ({ ...api, ...requests.commands(registry) }), [api, requests, registry]);
}

export function useRequests(): RequestAtoms {
  const requests = useContext(RequestsContext);
  if (!requests) throw new Error("Application request state is unavailable");
  return requests;
}
