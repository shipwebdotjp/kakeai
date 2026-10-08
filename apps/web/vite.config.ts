import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const rawPort = (process.env.KAKEAI_PORT ?? "").trim();
const apiPort = /^\d+$/.test(rawPort) ? rawPort : "4317";
const apiOrigin = `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ["@kakeai/contracts"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on("proxyReq", (proxyReq) => {
            proxyReq.setHeader("Origin", apiOrigin);
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
  },
});
