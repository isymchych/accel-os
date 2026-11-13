import { RegistryContext, useAtomMount } from "@effect/atom-react";
import { createContext, useContext, type ReactElement, type ReactNode } from "react";

import { runCommand, type Command, type CommandRunner } from "../transport/http-client.ts";
import type { AppModel } from "./app-model.ts";

const AppContext = createContext<AppModel | null>(null);

export function AppProvider({
  model,
  children,
}: {
  model: AppModel;
  children: ReactNode;
}): ReactElement {
  useAtomMount(model.workspace.subscription);
  return <AppContext.Provider value={model}>{children}</AppContext.Provider>;
}

export function useAppModel(): AppModel {
  const model = useContext(AppContext);
  if (!model) throw new Error("Application model is unavailable");
  return model;
}

/** Only result-dependent React actions cross from Effects into Promises. */
export function useRunCommand(): CommandRunner {
  const registry = useContext(RegistryContext);
  return <A,>(effect: Command<A>): Promise<A> => runCommand(registry, effect);
}
