import { defineConfig } from "vite";

export default defineConfig({
  // relative asset paths, so the build works under /pttern/ on GitHub Pages
  base: "./",
  // listen on the local network so the app can be opened from a phone
  server: { host: true, port: 5173 },
  preview: { host: true, port: 4173 },
  worker: { format: "es" },
  // manifold-3d loads its own .wasm; pre-bundling would break that path
  optimizeDeps: { exclude: ["manifold-3d"] },
});
