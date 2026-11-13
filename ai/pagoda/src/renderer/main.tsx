import { RegistryProvider } from "@effect/atom-react";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./theme.css";
import { createAppModel } from "./app/app-model.ts";
import { AppProvider } from "./app/app-provider.tsx";
import { authenticate } from "./transport/authentication.ts";
import { createWorkspaceEvents } from "./transport/workspace-events.ts";
import { WorkspaceScreen } from "./workspace/workspace-screen.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const application = createRoot(root);
void authenticate()
  .then(() => {
    const model = createAppModel(createWorkspaceEvents(), sessionStorage);
    application.render(
      <StrictMode>
        <RegistryProvider>
          <AppProvider model={model}>
            <WorkspaceScreen />
          </AppProvider>
        </RegistryProvider>
      </StrictMode>,
    );
  })
  .catch((error: unknown) => {
    application.render(
      <main className="p-6">
        <h1 className="text-lg font-semibold">Cannot connect to Pagoda</h1>
        <p role="alert">{error instanceof Error ? error.message : "Backend unavailable"}</p>
        <p>Start the backend and open its printed connection URL.</p>
      </main>,
    );
  });
