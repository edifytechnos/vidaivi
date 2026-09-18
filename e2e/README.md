# E2E harness

Browser regression suite for the built app, exercising the real production API.

```sh
node e2e/helpers.cjs                # offline checks, no browser and no network
npm run build                       # build dist/ (set VITE_GOOGLE_CLIENT_ID to test login screens)
node e2e/serve.cjs &                # serves dist/ on :4400, proxies /api/* to production
node e2e/regression.cjs             # runs the Playwright regression
node e2e/editor.cjs                 # drives the authoring editor (needs admin creds)
node e2e/tour.cjs                   # the first-run tour and the /help handover (needs admin creds)
```

- `helpers.cjs` covers the pure helpers in `api/shared/core.js`: the question
  counts stamped on write, the in-process cache's TTL and invalidation, and
  `inBatches`. It needs `api/node_modules` (`npm install` inside `api/`).
- The browser suite proxies `/api/*` to **production**, so it does not exercise
  unmerged API changes — point `E2E_API_BASE` at the PR preview to test those.
- Requires `playwright-core` and a Chromium binary (`CHROMIUM_PATH` to override
  the default managed-environment path).
- Admin/teacher flows run only when `E2E_ADMIN_USER` / `E2E_ADMIN_PASS` are set.
  **Never** commit credentials.
- `E2E_API_BASE` points the proxy elsewhere (e.g. a PR preview URL);
  `SHOT_DIR` saves full-page screenshots per step.
- In sandboxes with an egress proxy, start the server with `NODE_USE_ENV_PROXY=1`.
