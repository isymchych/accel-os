import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import "../styles/theme.css";
import { FoundationScreen } from "./foundation-screen.tsx";

const root = document.getElementById("root");
if (!root) throw new Error("Missing application root");
createRoot(root).render(
  <StrictMode>
    <FoundationScreen />
  </StrictMode>,
);
