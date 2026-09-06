import { defineConfig, loadEnv } from "vite";

// Local dev proxies /api/* to a deployed environment, because the API is
// Azure SWA managed Functions and doesn't run under Vite. Point it at a PR
// preview with VITE_API_TARGET to try changes before they reach production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "https://vidaivi.seyali.app";
  return {
    server: {
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          secure: true,
        },
      },
    },
  };
});
