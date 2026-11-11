import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./theme.css";
import { ApiProvider } from "./api.ts";
import { connectApi } from "./http-api.ts";
import { SessionScreen } from "./session-screen.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
const application = createRoot(root);
void connectApi()
  .then((workspace) => {
    application.render(
      <StrictMode>
        <ApiProvider api={workspace}>
          <SessionScreen />
        </ApiProvider>
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
