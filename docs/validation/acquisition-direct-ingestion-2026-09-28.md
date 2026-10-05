# Unified Amazon Acquisition — Direct Ingestion Validation

**Date:** 2026-09-28
**Status:** Local implementation and validation complete; production release has not been performed.
**Scope approved:** all current unified Amazon acquisition consumers.

## Outcome

The acquisition workflow no longer exposes a manual Snapshot review/confirm/reject step. A successful Provider Run is now **directly ingested** only after server-side admission checks complete. The result is still recorded as an immutable source Snapshot and an immutable confirmed Snapshot before it is projected to the appropriate consumer.

This change applies to current unified consumers:

| Consumer | Direct-ingestion outcome |
| --- | --- |
| `kb_images` | Projected into image knowledge-base sets/images, idempotently by consumer link. |
| `image_workflow` | Projected into the selected project’s competitor gallery research subject. |
| `kb_listing` | Catalog/listing facts projected to its knowledge-base record; downstream analysis remains a separate AI draft. |
| `kb_product` | Product facts and safely stored gallery projected to its knowledge-base record. |
| `project_competitor` | Project competitor snapshot becomes available for its separate analysis workflow. |
| `conversion_collector` | Confirmed acquisition evidence becomes available to the conversion collector. |
| `competitor_monitor` | A confirmed Snapshot and auditable consumer link are recorded. |

## Direct-ingestion state machine

```text
queued → running → normalized source Snapshot (draft)
       → safe asset storage + admission checks
       → immutable confirmed Snapshot (system_direct_ingestion provenance)
       → idempotent consumer projection + Consumer Link
       → confirmed / 已直接录入

Any failure, partial result, schema drift, missing qualification, budget refusal,
or unsafe/missing image asset → failed (closed; no consumer projection)
```

## Controls retained

Direct ingestion removes a manual **acquisition** review only. It does not weaken external-call or business-content controls:

- Provider remains server-side only; the legacy HTML crawler is not restored.
- Provider qualification, allowed capability checks, per-run/daily/monthly budgets, persistent Job/Run records, failure classification and cache controls remain enforced.
- Raw Provider response remains restricted to controlled storage; UI/API do not expose raw payloads, secrets, object keys, signed URLs, or test identifiers.
- For an image-gallery request, every returned candidate must be safely stored and at least one usable main/secondary image must exist; otherwise direct ingestion fails closed.
- Direct confirmation records `system_direct_ingestion` provenance. It does **not** claim a human reviewed the provider response.
- Existing immutable Snapshot hash, confirmation version, asset evidence and Consumer Link records remain.
- AI analysis and Listing results remain structured editable drafts. Their separate user editing/confirmation actions were intentionally retained; they are not acquisition review actions.
- Competitor images remain internal research evidence and cannot become image-generation source material.

## Removed surface

- Removed `AcquisitionReviewPage`.
- Removed acquisition `review`, `saveReview`, `confirmReview`, and `rejectReview` tRPC procedures.
- Retired `/knowledge/acquisition/review/:snapshotId` now redirects to `/knowledge/acquisition`, so historic bookmarks do not lead to a dead end.
- Task and consumer interfaces now describe `已直接录入` / `完成安全校验后将自动直接录入` rather than instructing the user to review a Snapshot.

## Local validation

| Check | Result |
| --- | --- |
| Acquisition direct-ingestion regression suite | Passed: 8 files, 22 tests |
| Direct-ingestion worker cache/queue behavior | Passed |
| Fail-closed asset admission and direct-confirmation provenance | Passed |
| Image-workflow projection and legacy consumer regression | Passed |
| Review surface removal / old-link redirect contract | Passed |
| Changed-file ESLint | Passed with zero warnings |
| Client undefined/early identifier gate | Passed |
| Production bundle and bundle budget | Passed |
| Diff consistency | Passed (`git diff --check`) |
| Full TypeScript check | 143 pre-existing diagnostics; no diagnostics on files changed for this implementation |

## Release boundary

No Provider call, AI run, business import, migration, production release, keyword task, or Heartbeat was triggered by this implementation or validation. A production release must remain a separate, explicit authorization and must use the established Qingdao atomic release procedure with service and static-health verification only.


## Qingdao production release

**Authorization:** user confirmed production release on 2026-09-28.
**Release ID:** `direct-ingestion-20260928T085024Z`
**Migration:** none.
**Provider / AI invocation:** none. No business acquisition, AI run, keyword task, or Heartbeat was created.

### Atomic release evidence

| Control | Result |
| --- | --- |
| Local production build, bundle budget, and direct-ingestion regression suite | Passed before release |
| Strict artifact privacy audit | Passed after removing a client-side database-URI example placeholder; no literal credential or database-URI pattern was present in the released bundle |
| Uploaded archive SHA-256 | Verified on Qingdao before extraction |
| Staging entry files | Verified non-empty and hash-matched before swap |
| Atomic activation | Previous `dist` preserved as a versioned backup; staged `dist` moved into place only after verification |
| Rollback | Automatic rollback handler installed for any post-swap failure; not triggered |
| Services | `amazon-listing-web`, `amazon-listing-worker`, and `amazon-listing-scheduler` all `active` |
| Local service health | `HTTP 200` from `127.0.0.1:3000/` |
| Public shell and entry | `HTTP 200` |
| Updated lazy chunks | Acquisition task page, image workflow, image knowledge base, and MCP manager resources all `HTTP 200` |
| Rollback copy | Preserved and verified under Qingdao’s protected backup directory |

### Deployed entry fingerprints

| Entry | SHA-256 |
| --- | --- |
| Web | `4676f59fbe97039cdd907bd510ab5c2f0dd82571cdcdc49892c18d5eddc5e2c1` |
| AI worker | `4c30b2a5973ca65608fd339c01a240060c247b801205d187346d46574aa77bed` |
| Scheduler | `2afff49e31dffc13168c6eef530fc549073672fe4279942551c2abba47dbeea7` |

### Separate operational observation

The production runtime configuration has no non-empty Manus OAuth server, portal, or app identifier values. The web process reports this at startup. Existing custom/local authentication behavior and the public application shell remain available; this release did not change authentication code or configuration. However, a **new Manus OAuth callback cannot complete** while that external configuration is absent. No authentication configuration was changed during this release because it is outside the authorized direct-ingestion scope and can affect account access. Treat configuration repair as a separate, explicitly authorized operation.


## Historical task-status clarification

A post-release screenshot exposed a presentation defect: legacy `review_required` jobs were rendered with the generic text **“等待安全校验”**. That wording was misleading because it made completed legacy Provider Runs look like they still needed a human review action.

A read-only production audit confirmed that the three visible legacy jobs have successful, zero-cost Provider Runs but their source snapshots are still `pending_review`, with no Confirmed Snapshot and no active Consumer Link. They do not qualify for direct ingestion because not every returned image has a safely stored asset. The missing-safe-asset counts are **1**, **2**, and **23** respectively. No provider was re-run and no data was changed during the audit.

The local UI correction now distinguishes:

| Status | User-facing meaning |
| --- | --- |
| `queued` / `running` | **自动安全校验中（无需人工审核）** — server-side validation only; successful completion proceeds automatically to direct ingestion. |
| `confirmed` | **已直接录入**. |
| `review_required` (legacy only) | **历史任务：安全入库未完成** — not a manual-review queue and not an already-ingested record. |
| `failed` | **失败关闭**. |

The correction does not relax asset storage controls and does not attempt to mark incomplete historical jobs as ingested. Targeted direct-ingestion tests, zero-warning ESLint, the client identifier gate, source-copy scan, and production build/bundle budget passed locally. Production deployment of this wording correction remains a separate authorization.


## Partial direct ingestion policy

The confirmed product decision is: **a missing source image must not prevent safely stored images from being directly ingested**.

| Stage | Behaviour |
| --- | --- |
| Provider and normalization succeed | Create the immutable source Snapshot and retain the Job/Run/audit record. |
| At least one requested gallery image is safely stored | Auto-confirm the Snapshot, approve only the safely stored asset candidates, and project them to the requested consumer. |
| Some returned images cannot be safely stored | Record the exact count as a visible evidence gap. Do not create a fake image, do not claim it is stored, and do not use it in downstream analysis. |
| No usable main or secondary image for a requested gallery | Fail closed; no consumer projection. |
| Product data schema / Provider result is partial or invalid | Keep the existing failure-close behavior. |
| User action after partial ingestion | Existing image-knowledge-base upload supplies manual images; the governed refresh action creates a new budget-gated Provider Job. Neither action silently retries a Provider call. |

For legacy jobs created under the previous all-assets-required policy, the task centre now exposes **“直接入库已保存图片”**. It is a deliberate, authenticated data action: it has no Provider call and no charge, but it creates a Confirmed Snapshot and consumer projection only for the already safely stored assets. It is not a manual content-review action.

Validation: 10 targeted Vitest tests, zero-warning ESLint for all changed files, the client runtime identifier gate, diff check, and a production build/bundle budget passed. The repository-wide TypeScript check still reports 143 documented historical diagnostics; there are zero diagnostics in the changed files. This policy update is local and has not modified production records or called a Provider.


## Qingdao production release and historical activation

**Authorization:** the user explicitly authorized Qingdao release and direct ingestion of the three screenshot-visible historical tasks.

**Release:** The checked production bundle was atomically published without a schema migration. The old `dist` directory was retained as a versioned rollback backup. Web, Worker, and Scheduler services restarted successfully and remained active; local HTTP and both public entry domains returned HTTP 200. Release markers for partial direct ingestion, legacy activation, and UI copy were verified in the deployed bundle. No Provider, AI, or crawler operation was executed.

The first SCP transfer stalled before any remote replacement; it was interrupted and the remote baseline was verified unchanged. The archive was then resumed with checksum verification and atomically swapped. The initial broad `sk-` literal scanner matched two strings inside a third-party Emacs-Lisp syntax grammar; hashes matched the installed syntax dependency, while the stricter credential checks found no project credential, environment file, database file, or personal path in the bundle.

**Historical activation:** a final read-only preflight verified that jobs **3**, **4**, and **5** each had one successful, zero-cost Provider Run, an eligible pending source Snapshot, no previously confirmed Snapshot, and usable safely stored gallery images. A single database transaction then directly ingested only their safely stored assets:

| Job | Consumer | Directly ingested | Missing / available for supplementation |
| --- | --- | ---: | ---: |
| 3 | Image knowledge base | 18 images | 1 |
| 4 | Project competitor gallery | 17 images | 2 |
| 5 | Image knowledge base | 63 images | 23 |

All three jobs and source Snapshots are now `confirmed`, have active consumer links, and retain a `system_partial_direct_ingestion` audit note. The two knowledge-base consumers have their image sets with 18 and 63 stored images respectively; the project competitor-gallery consumer has one research subject with 17 stored images. No missing asset was fabricated, no existing asset was deleted, and no source image was used as a first-party creative asset.


## Knowledge-base gallery sizing fix (local, pending production release)

A post-release screenshot showed oversized/cropped-looking gallery images. The persisted image records were complete (no missing delivery URL), and the symptom matched the display layout rather than a source-object loss. In `AmazonStyleGallery`, the main preview had only minimum/maximum heights while its image used `h-full`; the A+ row had no definite image-box height. `object-contain` therefore had no reliable containing box from which to preserve the image ratio.

The targeted rendering fix supplies definite boxes: 420px for the main/secondary preview and 320px for each A+ preview, with absolute full-box `object-contain` images and padding. Brand-story thumbnails also use `object-contain` rather than cropping. This changes no image object, metadata, source Snapshot, or consumer projection. Two dedicated sizing regressions, zero-warning ESLint, the client runtime identifier gate, production build, and bundle budget pass. The full repository TypeScript check remains at 143 documented historical diagnostics, with zero in the changed gallery files.


### Qingdao release

User authorized the gallery-sizing correction. The checked bundle was atomically published to Qingdao with no schema migration, no acquisition run, and no business-data write; the previous `dist` remains as a versioned rollback backup. Web, Worker, and Scheduler are active. The deployed knowledge-gallery chunk includes the fixed 320px A+ sizing and full-fit brand-story rules; `/knowledge/images` returned local HTTP 200 and the public route plus its lazy-loaded chunk returned HTTP 200. Recent Web-service logs show no rendering or startup fatal error.


## Balanced preview framing (local, pending production release)

A follow-up comparison showed that fixed preview dimensions solved overflow but still rendered source-canvas white space too literally. A read-only sample measurement found a near-square source canvas with visual content substantially below its geometric center, which explains the perceived misplaced blank area. The gallery now retains `object-contain` (so it never crops or changes stored pixels) and applies a small, client-side translation only when its local canvas analysis can safely detect a nonblank content bounding box. The translation is clamped so no image edge leaves the preview frame. Each main/secondary and A+ preview also has a **完整画布 / 平衡留白** control, allowing the user to switch back to the exact original canvas at any time. No image object, Snapshot, acquisition run, or business record is changed.

Three sizing/framing regressions, zero-warning ESLint, the client runtime identifier gate, the production build, and bundle budget pass. The full TypeScript check remains at 143 documented historical diagnostics, with zero in the changed gallery files.


### Qingdao balanced-preview release (2026-09-30)

User authorized the no-migration Qingdao release. The validated release artifact was transferred with SHA-256 verification, extracted into a staging directory, and atomically swapped only after the staged entry files and `KBImages` bundle matched their expected hashes. The release restarted the web, worker, and scheduler services and performed a local HTTP health check before finalizing; its previous `dist` remains in a versioned rollback backup.

Post-release verification confirms all three services are active; local HTTP, public root, public knowledge-image route, and the public `KBImages` resource return HTTP 200. The deployed bundle contains both **平衡留白** and **完整画布** controls. No migration, acquisition, Provider call, AI invocation, source-image mutation, or business-data write occurred.


## Direct-ingestion snapshot mapping repair (local, pending production authorization)

A user-reported image-workflow task failed after the Provider run completed. Read-only evidence shows the Provider profile was active, all four requested capabilities were qualified, the run returned one raw result at USD 0.00, and 76 of 77 image assets were safely persisted. The failure occurred afterward: the snapshot stored a valid normalized JSON object, but the Worker accessed only the camelCase property and received `undefined` under a historical physical-column mapping. The structured snapshot contract correctly rejected undefined data, but the job was incorrectly classified as a partial result.

The repair reads either the Drizzle camelCase or physical snake_case JSON field and explicitly rejects malformed JSON. It permits recovery only when a Snapshot was rejected by the system direct-ingestion contract; manual rejections and genuine unsafe/no-gallery failures remain closed. Ten acquisition regression tests, zero-warning ESLint, client identifier gate, production build, and bundle budget pass. Full TypeScript remains at 143 existing diagnostics, with none in the repaired files. No Provider call, retry, image mutation, or business-data write has occurred locally.
