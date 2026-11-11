/// <reference types="vite/client" />

import type { DesktopApi } from "../desktop-api.ts";

declare global {
  interface Window {
    pi: DesktopApi;
  }
}
