import { defineConfig, loadEnv } from "vite";

// One id per build, stamped into the bundle (__VIDAI_BUILD__) and written to
// /version.json beside it. An open tab compares the two to learn that a newer
// build is live — see src/beacon.ts. The commit is in it for reading a
// support report; the time is what makes two builds of one commit differ (QA
// rebuilds the same branch with other PRs merged on top).
const BUILD_ID = [(process.env.GITHUB_SHA ?? "local").slice(0, 7), Date.now().toString(36)].join("-");

// Local dev proxies /api/* to a deployed environment, because the API is
// Azure SWA managed Functions and doesn't run under Vite. Point it at a PR
// preview with VITE_API_TARGET to try changes before they reach production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const target = env.VITE_API_TARGET || "https://vidai.seyali.app";
  return {
    define: { __VIDAI_BUILD__: JSON.stringify(BUILD_ID) },
    plugins: [
      {
        name: "vidai-version",
        apply: "build",
        generateBundle() {
          this.emitFile({ type: "asset", fileName: "version.json", source: JSON.stringify({ build: BUILD_ID }) });
        },
      },
    ],
    server: {
      proxy: {
        "/api": {
          target,
          changeOrigin: true,
          secure: true,
          // The session is an httpOnly cookie, and the API sets it with the
          // deployed host's domain. A browser on localhost would throw that
          // away, so strip the domain and let it be host-only here — without
          // this, signing in appears to succeed locally and every call after
          // it comes back 401.
          cookieDomainRewrite: "",
        },
      },
    },
  };
});
