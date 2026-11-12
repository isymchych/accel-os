import path from "node:path";

import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type HtmlTagDescriptor } from "vite";

export default defineConfig({
  root: path.join(import.meta.dirname, "src/renderer"),
  base: "./",
  resolve: { alias: { "@": path.join(import.meta.dirname, "src/renderer") } },
  build: {
    outDir: path.join(import.meta.dirname, "dist/client"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 1000,
  },
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${process.env["PAGODA_BACKEND_PORT"] ?? "4317"}`,
        changeOrigin: false,
      },
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "application-content-security-policy",
      transformIndexHtml: {
        order: "post",
        handler(_html, context): HtmlTagDescriptor[] {
          const policy = context.server
            ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"
            : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'";
          return [
            {
              tag: "meta",
              attrs: { "http-equiv": "Content-Security-Policy", content: policy },
              injectTo: "head-prepend",
            },
          ];
        },
      },
    },
  ],
});
