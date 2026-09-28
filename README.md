# declgen — standalone Electron + React + TypeScript migration

This tree is the current standalone migration of Declgen from the supplied PyQt/Python application into an Electron desktop application with a React renderer and an embedded TypeScript domain/backend service.

The normal runtime path is now:

```text
React renderer
  ↓ narrow preload bridge / Electron IPC
Electron main process
  ↓
DeclgenService (TypeScript canonical case/state engine)
  ↓
TypeScript extraction / reconciliation / classification / transform / conformance / XML / audit services
  ↓
Windows filesystem + Alpha export
```

There is no normal-runtime dependency on a Python HTTP server.

A second runtime, `web/server.mjs`, serves the same `DeclgenService` and React build over HTTP for browser access (including remote access through a Cloudflare quick tunnel started by `web/run/watchdog.ps1` / `watchdog.sh`). It does not have the Electron security boundary described below; see [Web runtime](#web-runtime).

## State model

The implementation follows the canonical state-flow contract (the original `DECLGEN_STATE_FLOW_PROMPT.md` is not included in this repository):

- UI components own drafts, never authoritative customs state.
- Confirmed edits write one canonical owner and require `case_id + base_revision`.
- Confirmed semantic changes increment `case_revision` and invalidate old declaration/XML.
- Build records `built_from_revision` plus a canonical snapshot fingerprint.
- Independent conformance records `validated_revision` only for the current build.
- `READY` is backend-derived; the renderer only displays it.
- Approval rechecks revision, readiness, unresolved reviews, placeholders, conformance errors and hidden fingerprint drift.
- Approved/exported cases are frozen. Further canonical mutation requires **New order**.
- Approved snapshots contain source manifest, canonical inputs/decisions, declaration, conformance, XML and revision metadata.

## Desktop security boundary

The renderer has no Node integration. Electron uses:

- `contextIsolation: true`
- `sandbox: true`
- `nodeIntegration: false`
- `webSecurity: true`
- default-deny Electron permissions
- restricted navigation/window opening
- HTTPS-only external links
- sender validation on every IPC handler
- native picker capabilities: a renderer path is usable only after the main process itself granted that exact file/folder
- a narrow, frozen preload API
- CSP in `index.html`

Local LLM process start/stop is restricted to the configured localhost endpoint and fixed known Windows starter files; renderer-supplied executable paths/ports are not accepted.

## Development toolchain

Direct dependency versions are exact, not `latest`/ranges. The repository also pins:

```text
Node 22.16.0  (.nvmrc / engines)
npm  10.9.x   (packageManager / engines)
Vite dev port 5173, strictPort=true
```

`package-lock.json` is committed; use `npm ci` for reproducible installs.

## Commands

```bash
npm run dev        # strict Vite :5173 + Electron
npm run typecheck  # renderer + core/electron/preload/config checks
npm test           # node regression suite
npm run build      # typecheck + Electron/core compile + Vite build
npm start          # compiled desktop application
npm run dist       # Windows NSIS package
npm run ci         # npm ci + checks/tests/build; requires committed lockfile
```

## Web runtime

```bash
npm run build          # web/server.mjs loads dist/ and dist-electron/
node web/server.mjs    # http://127.0.0.1:48913
```

| Variable            | Default                                              | Effect                                                    |
| ------------------- | ---------------------------------------------------- | --------------------------------------------------------- |
| `DECLGEN_WEB_PORT`  | `48913`                                              | listen port                                               |
| `DECLGEN_WEB_HOST`  | `127.0.0.1`                                          | listen address                                            |
| `DECLGEN_AUTH`      | on                                                   | `off` disables accounts; all browsers then share one case |
| `DECLGEN_DATA_ROOT` | `~/.declgen-data` (`userData/declgen-data` in Electron) | cases, runs, catalog, auth, history, telemetry            |

With accounts on, each account has its own active case (`active-case.<account>.json`) and requests are serialized so accounts never interleave case state. The client catalog, LLM configuration and telemetry are shared by all accounts.

File and folder pickers on the web surface open native dialogs only for same-machine requests; remote browsers upload file bytes instead.

## Machine-specific paths

- Alpha export destination: `C:\alpha\exports` on Windows, `<data root>/alpha-exports` elsewhere.
- Local LLM starters: `C:\ai\start-local-ai.vbs` (text) and `C:\ai\start-qwen3vl-fixed.vbs` (vision); default text endpoint `http://127.0.0.1:10000/v1/chat/completions`.
- Cloudflare tunnel binary (watchdog): `C:\Program Files (x86)\cloudflared\cloudflared.exe`.

See `AUDIT_FIXES.md` for the exact audit finding status and `MIGRATION.md` for source/reconstruction provenance.

## Important production qualification

The supplied RAR did not contain several modules referenced by the Python application, notably the original `transform.py`, `transform_ex.py`, `webid.py`, and the previous Python web API layer. The TypeScript declaration transforms therefore had to be reconstructed from the supplied declaration models, conformance rules, report/controller contracts and state-flow specification. They are isolated and regression-tested, but they still require comparison against known-good production declarations/customs fixtures before production filing.
