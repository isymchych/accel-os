import { render } from "@solidjs/web";

import { FoundationScreen } from "./foundation-screen.tsx";

import "../styles/theme.css";

const rootElement = document.getElementById("root");
if (rootElement === null) {
  throw new Error("Missing application root element.");
}

render(() => <FoundationScreen />, rootElement);
