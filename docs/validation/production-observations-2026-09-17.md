# Production observations — 2026-09-17

## Acquisition create-job error contract

The no-migration atomic deployment was completed before the latest observation. The first production contract verifier invoked `acquisition.createJob` in a controlled workspace with no Provider Profile. It received HTTP 412 with tRPC code `PRECONDITION_FAILED`, application code `PRECONDITION_FAILED`, reason `profile_not_configured`, and a readable administrator-action message. Count checks before and after confirmed `jobCreated=false`, `aiJobCreated=false`, and `providerRunCreated=false`.

A second read-only verifier was targeted to find a user workspace whose primary Apify profile is in `qualification_pending`. The production registry did contain the governed profile, but no active user’s default workspace matched that row. The verifier therefore correctly exercised the no-profile branch again and did not create any record or outbound call. This is a configuration-scope observation, not a reason to activate or alter the pending Provider Profile.

## N3 attribute-table diagnostic

The production read-only N3 diagnostic queried recent `projectFiles` rows with `fileType=product_attributes`, recent `analysis.rufus.attribute` Emperor Skill runs, the corresponding Skill registry record, the model-registry activity summary, and runtime variable-presence flags. It performed no database write, file reanalysis, LLM call, or Provider call.

The terminal output showed recent N3 files in `failed` status and corresponding Rufus Skill runs in `failed` status. Existing failure text is persisted in generic classified form, so the initial safe summary categorized it as `UNCLASSIFIED_ERROR`. The relevant Skill itself is present and released; the next diagnostic step is to identify the actual underlying error source through a code-level fix to preserve safe failure codes and the model routing decision, without rerunning the user’s file or calling a model.

The Aliyun Workbench terminal automatically disconnected after each command execution; this affected only viewing terminal output and did not indicate a production application outage.

### Confirmed root cause

The more specific read-only Skill-run summary showed `PROVIDER_UNAVAILABLE` for the failed N3 Rufus runs. The selected governed model is active and carries a configured credential reference, so the incident is not an absent Skill, a disabled model, or a missing model-key reference.

The application’s `TEAMOROUTER_SOCKS_PROXY` is configured for loopback port **1088**. The required `teamorouter-egress-tunnel.service` is configured to establish that SOCKS listener through a restricted SSH tunnel. At diagnosis time, no listener existed at 127.0.0.1:1088. A safe service restart was attempted and it again did not produce the listener. Service logs show the restricted egress SSH connection timing out to its preconfigured remote endpoint and exiting with code 255; systemd has repeatedly retried it. This is the direct reason the N3 model calls fail closed as `PROVIDER_UNAVAILABLE` before processing the uploaded table.

No user file was re-uploaded, re-parsed, or retried. No LLM completion, Amazon Provider call, acquisition job, keyword task, or Heartbeat was started.

### Recovery follow-up

After the requested recovery route was selected, the existing egress service was checked again without a model call. It remains `active` at the systemd process level, but its configured SOCKS port 1088 is still not listening. The unit’s restricted SSH connection remains in a timed-out wait state for the preconfigured remote endpoint. Therefore the exit has **not yet been restored**, and retrying the N3 file would still fail closed. Remote-endpoint or network-path intervention is required before another local port check can succeed.

The remote endpoint’s separate Emperor HTTP health route was also probed without credentials and timed out on port 4800. A separate unauthenticated HTTPS connectivity check to the external model service reached the TLS peer but did not return an HTTP response within the short health budget. The original remote service is therefore not reachable through either of its two expected routes from Qingdao. The local sandbox has no active Google Cloud CLI identity or cloud-provider connector for that remote host, so it cannot legitimately inspect, start, recreate, or change the remote server without the owner authorizing and connecting a cloud account or selecting a replacement provider.

### Emergency fallback implementation — pending no-migration release

A later read-only production runtime check confirmed that Qingdao is intentionally configured with `LLM_PROVIDER=external` and that both external-model and Forge credential variables are present; the local Teamorouter SOCKS listener remains absent. This means the original external route must remain the primary route, but the application has an already provisioned, server-side Forge capability that can serve as a governed emergency fallback without exposing a credential or changing the external configuration.

The local remediation makes `manus-default` the first fallback candidate and binds only that registered `manus_builtin` candidate to Forge at the low-level Skill runner. The configured external model remains the first candidate. Because the governed resolver permits at most two attempts, this ordering guarantees that a Teamorouter tunnel outage reaches Forge instead of spending the sole fallback attempt on a second external model sharing the failed tunnel. Business routes, clients, raw prompts, uploaded files, and arbitrary model endpoints cannot select the override; the override requires the internal Skill-runner bypass reason and still records the selected provider/model in the Emperor Skill Run ledger.

The change has passed local unit regression, affected-file ESLint, production build, and bundle-budget validation. It has not been deployed to Qingdao and no model, file analysis, user-upload retry, Provider Run, keyword task, or Heartbeat was started during this work. A real N3 reanalysis remains a separate, user-approved action after a no-migration release and a no-content model-health verification.
