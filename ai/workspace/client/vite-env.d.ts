/// <reference types="vite/client" />

import type { DesktopApi } from "../contracts/desktop.ts";

declare global {
  interface Window {
    pi: DesktopApi;
  }
}
