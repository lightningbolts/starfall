import { defineConfig } from "vite";

export default defineConfig({
  server: {
    port: 5173,
    strictPort: false,
    headers: {
      "Cache-Control": "no-store",
    },
    proxy: {
      "/ws": {
        target: "ws://localhost:8787",
        ws: true,
      },
    },
  },
  optimizeDeps: {
    // Keep workspace packages as source so edits invalidate immediately
    exclude: ["@starfall/macro-sim", "@starfall/sim"],
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
