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
