# Declgen migration provenance and architecture

## Goal

Replace the PyQt review station and, where source evidence permits, the Python backend/domain implementation with a standalone Electron + React + TypeScript desktop application while preserving verified customs behavior and implementing the supplied canonical state-flow contract.

## What was actually supplied

The archive contained roughly thirty Python modules plus the PyQt controller. The original controller referenced additional modules that were absent from the RAR. The most important absent modules were the import/export declaration transforms (`transform.py`, `transform_ex.py`), `webid.py`, and the previous web API layer.

Consequently the migration distinguishes **ported** code from **reconstructed** code. Missing behavior was not presented as a verbatim source port.

## Architecture

```text
Electron main
  ├─ trusted renderer / navigation checks
  ├─ native file/folder selection capabilities
  ├─ save dialog / filesystem boundary
  └─ narrow IPC dispatcher
       ↓
DeclgenService
  ├─ canonical CaseState + persistent active case
  ├─ extraction / document facts
  ├─ dossier reconciliation
  ├─ invoice + H1 confirmed edits
  ├─ confirmed classifications
  ├─ deterministic build snapshot
  ├─ conformance / READY computation
  ├─ XML + TRACE
  └─ approval / immutable snapshot / Alpha export
       ↓
core/*.ts domain modules
```

React is deliberately downstream of the state engine. Polling can refresh views, but cannot silently mutate business state.

## Major source-to-TypeScript mappings

| Python concern                  | TypeScript implementation                                                     |
| ------------------------------- | ----------------------------------------------------------------------------- |
| PyQt `MainWindow` mutable state | `DeclgenService` + `CaseState`; React stores drafts/views only                |
| `QThread` task UI               | service task state + cooperative cancellation + revision-aware polling        |
| `QFileDialog`                   | Electron native picker + main-process grants                                  |
| dossier extraction              | `core/pdf.ts`, `tabular.ts`, `extract.ts`, `vision.ts`, service orchestration |
| packing reconciliation          | `core/packing.ts`                                                             |
| client/catalog persistence      | `core/clients.ts`, `catalog.ts`                                               |
| classification decisions        | `core/classification-review.ts` + canonical revision bump                     |
| H1 context                      | `core/declaration-context.ts` + one canonical context writer                  |
| BNB FX                          | `core/fx.ts`                                                                  |
| conformance                     | `core/conformance.ts`, `conformance-ex.ts`                                    |
| BG415A/BG515C models/XML        | `core/model.ts`, `xmlio.ts`, `bg515c.ts`                                      |
| audit/TRACE/case package        | `core/workflow.ts`, `report.ts`                                               |
| LLM/vision/TARIC                | `core/llm.ts`, `vision.ts`, `taric.ts`                                        |
| approval copy to Alpha          | transactional preparation + frozen snapshot + final copy + frozen live state  |

## Reconstructed modules

`core/transform.ts` and `core/transform-ex.ts` are reconstructions because the referenced Python source modules were not present. They were derived from:

1. the supplied declaration data models/XML emitters;
2. import/export conformance checks;
3. reporting and UI/controller inputs;
4. packing/client/catalog behavior in the supplied modules;
5. `DECLGEN_STATE_FLOW_PROMPT.md` invariants.

They should be qualified against known-good production fixtures before customs production use.

## Important defects intentionally not preserved

- The Python `CaseState` revision machinery existed but was not coherently wired through build/validation/approval. The new service wires those transitions directly.
- The old UI/controller pattern maintained many competing mutable `self.*` truths. The new backend has one canonical case owner and uses renderer drafts only until Confirm.
- Approved cases were not truly immutable in active memory. `APPROVED/EXPORTED` now rejects canonical mutation; a new case identity is required.
- Packing line-mass field naming was normalized so reconciled `line_masses` reaches the transform.
- Renderer polling no longer owns/overwrites dirty invoice/H1/build-parameter drafts.
- H1 save no longer injects arrival identifier code `30` or drops valid `0` values.

## Approval sequence

Approval now performs these checks before any export:

```text
case_id/base_revision exact match
→ declaration exists
→ backend readiness blockers
→ canonical fingerprint == built fingerprint
→ prepare EXPORTED CaseState copy
→ write approved XML + immutable snapshot + audit into approved run directory
→ copy final XML to Alpha destination
→ mark live CaseState APPROVED → EXPORTED
→ persist active state
```

The approved snapshot is built from a separate frozen state copy, so a failed filesystem export does not prematurely turn the live case into APPROVED/EXPORTED.

## Remaining qualification work

- Launch Electron on Windows and exercise native dialogs, local LLM process control and Alpha export.
- Run real UI accessibility/UX walkthroughs (keyboard, zoom, table overflow, screen-reader labels).
- Compare reconstructed import/export transforms against a representative set of known-good declarations and expected XML.
- Run any desired external static graph/security scanner once dependencies and the executable are available.
