# Audit remediation status

This file responds directly to the supplied review. `FIXED` means the source has been changed and covered by either executable core tests or source-contract tests. `PARTIAL` means a limitation of the generation environment remains.

| Finding | Status | Remediation / evidence |
| --- | --- | --- |
| Vite can silently move from 5173 | **FIXED** | `vite.config.ts` sets `port: 5173` and `strictPort: true`; Electron accepts only `http://127.0.0.1:5173` in dev. |
| `latest` dependencies / no reproducibility | **PARTIAL** | All direct versions are exact; Node/npm are pinned via `.nvmrc`, `engines`, `packageManager`, `.npmrc`. Registry access timed out, so `package-lock.json` could not honestly be generated here. Generate/commit it on a networked machine, then use `npm ci`. |
| TypeScript gate excludes infra | **FIXED** | `tsconfig.node.json` includes `core`, `electron/**/*.ts`, `electron/**/*.cjs`, tests and `vite.config.ts`, with `allowJs/checkJs`. |
| Electron upload bridge reads arbitrary paths | **FIXED** | Renderer can use only exact main-process file/folder capabilities granted by native picker. IPC sender is validated. Upload endpoint is allowlisted. Save destination comes from `showSaveDialog`. |
| Electron security claims unverified | **FIXED in source / runtime still to launch** | `sandbox`, `contextIsolation`, no Node integration, `webSecurity`, default-deny permissions, restricted navigation/windows, HTTPS-only external links, sender validation, CSP and narrow frozen preload bridge are present. Runtime penetration testing still requires installed Electron. |
| Polling discards invoice/H1 edits | **FIXED** | Dirty drafts are preserved. Drafts capture case/revision. Backend rejects stale commits. Clean drafts may resynchronize from canonical state. |
| H1 save forces arrival code `30` / loses `0` | **FIXED** | Arrival code is loaded/editable/preserved; no constant `30`. Nullish handling preserves `0`. Unknown nested context fields are preserved. |
| Build params remain from old state/case | **FIXED** | Build draft is scoped to case/revision. Clean state resyncs; dirty draft becomes visibly stale after canonical change and build is blocked until reset/rebase. |
| Clear leaves XML/TRACE/catalog stale | **FIXED** | Case-id change clears dashboard/classification/XML/TRACE; clear explicitly resets case views; empty/new-client catalog is cleared. Case-scoped responses with another case id are ignored. |
| Async task completion leaves views stale | **FIXED** | Revision/stage/task-active→finished transitions refresh dashboard, classification and XML/TRACE. Command wrapper also refreshes affected views. |
| Failed validation can fall through | **FIXED** | New-importer submit stops on either `ok:false` or validation errors. Embedded IPC has no HTTP-status ambiguity; exceptions become `ok:false`. |
| Approval UI ignores readiness | **FIXED** | Backend returns explicit `readiness` + blockers; UI enables approval only when `readiness.ready`. Backend independently rechecks revision, blockers and build fingerprint before export. |
| Dashboard reports ready while blockers exist | **FIXED** | Success hero requires backend `readiness.ready`; blockers get danger state/list. |
| Shared modals lack keyboard semantics | **FIXED in source** | `role=dialog`, `aria-modal`, labelled title, initial focus, Tab trap, Escape close and focus restoration. Rendered accessibility testing still requires running UI. |
| State contract implementation unverified | **IMPROVED / core verified** | `CaseState` has executable revision/stale/READY/freeze tests; service writes use `case_id + base_revision`; approval uses fingerprint drift check and frozen snapshots. Full Electron end-to-end state testing remains pending dependency install. |
| Approved output can later mutate | **FIXED** | `APPROVED/EXPORTED` is frozen; canonical edits/builds throw. New order creates a new case identity. Snapshot uses a separately frozen final-state copy. |
| Product Design walkthrough unavailable | **UNRESOLVED runtime check** | Source-level modal/accessibility corrections made; no installed/runnable Electron renderer in this environment. |
| Fallow/build/executable scan unavailable | **UNRESOLVED environment check** | Source is present now, but npm dependency installation timed out; no executable or dependency-aware graph build could be produced here. |

## Verification executed here

- TypeScript syntax-transpile: all project `.ts/.tsx` source files, zero syntax diagnostics.
- `node --check electron/preload.cjs`: pass.
- Node regression/source-contract suite: see `tests/`; state machine, transforms, security contract and audit regression checks.

## What must still be done on a normal networked Windows build machine

```bash
nvm use
npm install --package-lock-only --ignore-scripts
# inspect and commit package-lock.json
npm ci
npm run typecheck
npm test
npm run build
npm run dist
```

Then run the real operator workflows from `DECLGEN_STATE_FLOW_PROMPT.md`, especially Cancel semantics, replacement documents, H1 edits after build, classification confirmation + restart, package propagation and final approved-snapshot reload/reproducibility.
