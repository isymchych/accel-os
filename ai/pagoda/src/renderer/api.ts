import { createContext, createElement, useContext, type ReactElement, type ReactNode } from "react";

import type { WorkspaceApi } from "../contracts/index.ts";

const ApiContext = createContext<WorkspaceApi | null>(null);

export function ApiProvider({
  api,
  children,
}: {
  api: WorkspaceApi;
  children: ReactNode;
}): ReactElement {
  return createElement(ApiContext.Provider, { value: api }, children);
}

export function useApi(): WorkspaceApi {
  const api = useContext(ApiContext);
  if (!api) throw new Error("Application API is unavailable");
  return api;
}
