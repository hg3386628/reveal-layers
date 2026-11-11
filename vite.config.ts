import { readFileSync } from "node:fs";
import { defineConfig } from "vite";

export default defineConfig({
  // Relative base so GitHub Pages sub-paths and file previews both work.
  base: "./",
  publicDir: "public",
  server: { host: "127.0.0.1", port: 5173 },
  preview: { host: "127.0.0.1", port: 4173, strictPort: true },
  plugins: [
    {
      name: "demo-body",
      transformIndexHtml(html) {
        return html.replace(
          "<!--app-->",
          readFileSync(new URL("./src/template.html", import.meta.url), "utf8")
        );
      },
    },
  ],
  build: {
    outDir: "dist/pages",
    emptyOutDir: true,
    target: "es2022",
    sourcemap: false,
    cssCodeSplit: false,
    assetsDir: "assets",
  },
});
