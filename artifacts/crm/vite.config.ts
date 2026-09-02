import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { cartographer } from "@replit/vite-plugin-cartographer";
import { devBanner } from "@replit/vite-plugin-dev-banner";
import {
  resolveViteBasePath,
  resolveVitePort,
} from "./vite-config-env";

export default defineConfig(({ command }) => {
  const port = resolveVitePort(process.env.PORT, command);
  const basePath = resolveViteBasePath(process.env.BASE_PATH, command);

  return {
    base: basePath,
    plugins: [
      react(),
      tailwindcss(),
      runtimeErrorOverlay(),
      ...(process.env.NODE_ENV !== "production" &&
      process.env.REPL_ID !== undefined
        ? [
            cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
            devBanner(),
          ]
        : []),
    ],
    define: {
      // Injected at build/start time so the version footer shows when the server last built
      __BUILD_TS__: JSON.stringify(Date.now()),
    },
    resolve: {
      alias: {
        "@": path.resolve(import.meta.dirname, "src"),
        "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      },
      dedupe: ["react", "react-dom"],
    },
    root: path.resolve(import.meta.dirname),
    build: {
      outDir: path.resolve(import.meta.dirname, "dist/public"),
      emptyOutDir: true,
    },
    server: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
      fs: {
        strict: true,
        deny: ["**/.*"],
      },
      // Local development only. The deployed app serves the API and the client
      // from one origin through the platform router, so `/api` is same-origin
      // there and no proxy exists. Running the two apart on a workstation
      // breaks that assumption; setting API_PROXY_TARGET restores it.
      // Unset — as in every build and deploy — this is absent entirely.
      ...(process.env.API_PROXY_TARGET
        ? {
            proxy: {
              "/api": {
                target: process.env.API_PROXY_TARGET,
                changeOrigin: false,
              },
            },
          }
        : {}),
    },
    preview: {
      port,
      host: "0.0.0.0",
      allowedHosts: true,
    },
  };
});
