import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  build: { outDir: "dist/client", emptyOutDir: true },
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "desktop-content-security-policy",
      transformIndexHtml(html, context): string {
        const policy = context.server
          ? "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://127.0.0.1:5173; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'"
          : "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'none'; img-src 'self' data:; object-src 'none'; base-uri 'none'; frame-src 'none'";
        return html.replace("WORKSPACE_CONTENT_SECURITY_POLICY", policy);
      },
    },
  ],
});
