import { createContext, createElement, useContext, type ReactElement, type ReactNode } from "react";

import type { NativeApi, WorkspaceApi } from "../desktop-api.ts";

interface ApplicationApi {
  workspace: WorkspaceApi;
  native: NativeApi;
}

const ApiContext = createContext<ApplicationApi | null>(null);

export function ApiProvider({
  api,
  children,
}: {
  api: ApplicationApi;
  children: ReactNode;
}): ReactElement {
  return createElement(ApiContext.Provider, { value: api }, children);
}

export function useApi(): ApplicationApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("Application API is unavailable");
  return api;
}
