import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import autoprefixer from "autoprefixer";
import tailwindcss from "tailwindcss";
import { defineConfig } from "vite";

const here = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: here,
  plugins: [react()],
  resolve: { alias: { "@shared": path.resolve(here, "../shared") } },
  css: { postcss: { plugins: [tailwindcss({ config: path.join(here, "tailwind.config.js") }), autoprefixer()] } },
  server: {
    port: 5173,
    proxy: { "/api": `http://127.0.0.1:${process.env.PORT ?? 4310}` },
  },
  build: { outDir: path.resolve(here, "../dist/web"), emptyOutDir: true },
});
