import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const rawPort = (process.env.KAKEAI_PORT ?? "").trim();
const apiPort = /^\d+$/.test(rawPort) ? rawPort : "4317";
const apiOrigin = `http://127.0.0.1:${apiPort}`;

const viteOrigins = new Set([
  "http://localhost:5173",
  "http://127.0.0.1:5173",
  "http://[::1]:5173",
]);
const safeMethods = new Set(["GET", "HEAD", "OPTIONS"]);

export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    exclude: ["@kakeai/contracts", "@kakeai/video"],
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: apiOrigin,
        changeOrigin: true,
        bypass: (req, res) => {
          const deny = () => {
            res?.writeHead(403).end();
            return false as const;
          };
          const rawSite = req.headers["sec-fetch-site"];
          const site = Array.isArray(rawSite) ? rawSite[0] : rawSite;
          if (typeof site === "string" && site !== "same-origin" && site !== "none") {
            return deny();
          }
          const rawOrigin = req.headers.origin;
          const origin = Array.isArray(rawOrigin) ? rawOrigin[0] : rawOrigin;
          if (typeof origin === "string" && !viteOrigins.has(origin)) {
            return deny();
          }
          if (!safeMethods.has(req.method ?? "") && origin === undefined && site !== "same-origin") {
            return deny();
          }
          return undefined;
        },
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
