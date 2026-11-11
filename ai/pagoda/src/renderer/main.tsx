import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "./theme.css";
import { ApiProvider } from "./api.ts";
import { SessionScreen } from "./session-screen.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <ApiProvider api={{ workspace: window.pi, native: window.pi }}>
      <SessionScreen />
    </ApiProvider>
  </StrictMode>,
);
