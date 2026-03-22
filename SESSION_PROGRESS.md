# Mintay Progress

Last updated: 2026-03-22

## Current status

- GitHub repo: `https://github.com/iamichaelayomide/Mintay`
- Render backend URL: `https://mintay.onrender.com`
- Health check verified: `GET /health` returns `200` with `ok: true`
- Root URL `GET /` returns `404 Not Found`, which is expected for this API-only backend
- Render CLI installed locally: `render v2.14.0`
- Render CLI login completed on this machine

## Deployment fixes already completed

- Removed hardcoded `PORT=3001` from [`render.yaml`](C:/Users/DELL/mintay/render.yaml) for Render compatibility
- Fixed backend start script in [`backend/package.json`](C:/Users/DELL/mintay/backend/package.json) to use `node dist/backend/src/index.js`
- Updated plugin manifest backend domain to `https://mintay.onrender.com`
- Rebuilt plugin bundle in `plugin/dist/`
- Pushed deployment fixes to GitHub commit `feccdfe` with message `Fix Render deployment configuration`

## Figma manifest fix

- Publishing/import error was caused by `http://localhost:3001` being listed in `networkAccess.allowedDomains`
- Fix applied:
  - production domain stays in `allowedDomains`
  - localhost moved to `devAllowedDomains`
  - added `networkAccess.reasoning`

## Figma runtime compatibility fix

- Figma plugin runtime was failing on newer generated JavaScript syntax in the sandbox bundle
- Fix applied in [`plugin/vite.config.ts`](C:/Users/DELL/mintay/plugin/vite.config.ts):
  - sandbox build target set to `es2017`
- Plugin bundle rebuilt after this fix
- Next retry should use a freshly re-imported development plugin so Figma loads the new `dist` files

## Current optimization pass

- Section detection is being moved off the plugin UI bundle and onto a backend `/analyze` endpoint
- Goal: keep candidate file/section chips while shrinking the Figma plugin bundle and avoiding heavy AST parsing in the UI thread
- Repo imports are being upgraded into a two-step flow: parse full repo -> review detected screens -> import only the selected screens into Figma
- Runtime-execution pivot started: backend now has a `/repo-runtime/prepare` path that downloads a GitHub repo archive, extracts it to a temp workspace, detects package manager/framework/dev command, and lists candidate route files for the next runner step
- Runtime runner expanded: backend now has `/repo-runtime/launch`, `/repo-runtime/status/:repoId`, and `/repo-runtime/stop` endpoints to install dependencies, start a prepared repo on a local preview port, and track logs/status for the next DOM-extraction phase

## What still needs to happen

1. In Figma Desktop, import the plugin from [`plugin/manifest.json`](C:/Users/DELL/mintay/plugin/manifest.json)
2. In the plugin settings:
   - Backend URL: `https://mintay.onrender.com`
   - Gemini API key: paste the real key
3. If Mintay was already imported before the runtime fix, remove/re-import it so Figma stops using the old bundle
4. Test a simple import in Figma
5. If publishing to Community:
   - ensure 2FA is enabled
   - publish from Figma plugin management
   - complete listing details, icon, and cover assets

## Known behavior

- `POST /parse` returns `AI service unavailable` when called with an invalid or fake API key
- This means the backend route is live; successful parsing still depends on a valid Gemini API key

## Resume prompt

If resuming later, start with:

`Open SESSION_PROGRESS.md in the Mintay repo and continue from the Figma import/publish step.`
