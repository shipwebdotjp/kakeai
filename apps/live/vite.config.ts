import { resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const appRoot = import.meta.dirname;
const webRoot = resolve(appRoot, "web");

export default defineConfig({
  root: webRoot,
  plugins: [react()],
  build: {
    outDir: resolve(appRoot, "dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        stage: resolve(webRoot, "stage.html"),
        console: resolve(webRoot, "console.html"),
      },
    },
  },
});
