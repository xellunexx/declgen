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

## State model

The implementation follows `DECLGEN_STATE_FLOW_PROMPT.md`:

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

### Lockfile status

`package-lock.json` is **not present in this generated artifact**. The execution environment could not reach/resolve the npm registry long enough to generate it (`npm install --package-lock-only` timed out, and the required packages were not available in the local npm cache).

Do not call dependency resolution fully reproducible until a lockfile is generated on a networked workstation and committed:

```bash
nvm use
npm install --package-lock-only --ignore-scripts
# review package-lock.json, commit it
npm ci
npm run typecheck
npm test
npm run build
```

After the lockfile exists, automated builds should use `npm ci`, not `npm install`.

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

## Verification performed in the generation environment

Because npm dependencies could not be installed here, a full dependency-aware `tsc`, Vite build, Electron launch and NSIS package could not be completed. The checks that *were* executed are:

- all project `.ts/.tsx` source files syntax-transpiled with the available TypeScript compiler;
- `electron/preload.cjs` checked with `node --check`;
- dependency-free core/state/transform and source-contract regression tests executed with Node.

See `AUDIT_FIXES.md` for the exact audit finding status and `MIGRATION.md` for source/reconstruction provenance.

## Important production qualification

The supplied RAR did not contain several modules referenced by the Python application, notably the original `transform.py`, `transform_ex.py`, `webid.py`, and the previous Python web API layer. The TypeScript declaration transforms therefore had to be reconstructed from the supplied declaration models, conformance rules, report/controller contracts and state-flow specification. They are isolated and regression-tested, but they still require comparison against known-good production declarations/customs fixtures before production filing.
