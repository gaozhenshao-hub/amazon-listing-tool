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
