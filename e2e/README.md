# E2E harness

Browser regression suite for the built app, exercising the real production API.

```sh
npm run build                       # build dist/ (set VITE_GOOGLE_CLIENT_ID to test login screens)
node e2e/serve.cjs &                # serves dist/ on :4400, proxies /api/* to production
node e2e/regression.cjs             # runs the Playwright regression
```

- Requires `playwright-core` and a Chromium binary (`CHROMIUM_PATH` to override
  the default managed-environment path).
- Admin/teacher flows run only when `E2E_ADMIN_USER` / `E2E_ADMIN_PASS` are set.
  **Never** commit credentials.
- `E2E_API_BASE` points the proxy elsewhere (e.g. a PR preview URL);
  `SHOT_DIR` saves full-page screenshots per step.
- In sandboxes with an egress proxy, start the server with `NODE_USE_ENV_PROXY=1`.
