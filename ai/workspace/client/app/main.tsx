import { RouterProvider } from "@tanstack/react-router";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { router } from "./routes.tsx";

import "../styles/theme.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing application root element.");
}

createRoot(rootElement).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
