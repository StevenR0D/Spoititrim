import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Renderer is served by Vite in dev, and built to dist/ for production.
// base: "./" matters because Electron loads the built index.html via file://,
// so asset paths must be relative, not absolute.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
  host: "127.0.0.1",
  port: 5173,
  strictPort: true
},
  build: {
    outDir: "dist"
  }
});
