# Teamorouter endpoint and model-catalog validation — 2026-09-20

## Sources

The official [API integration document](https://teamorouter.com/zh/docs/api-integration) states that its OpenAI-compatible endpoint uses `https://api.teamorouter.cn/v1`, the model catalog is available from authenticated `GET /v1/models`, and Chat Completions use `POST /v1/chat/completions` with a Bearer API key. The document lists the currently relevant model families, including GPT, Claude, Gemini, DeepSeek, GLM, and Grok.

The official [billing and usage document](https://teamorouter.com/zh/docs/open-api) states that usage and final costs are dynamic and should be obtained from billing APIs rather than inferred from a static price table. Therefore the application must present newly registered Teamorouter models as “supplier actual billing” until a governed billing reconciliation is implemented.

## Controlled production observations

A no-charge authenticated catalog read from Qingdao to `https://api.teamorouter.cn/v1/models` succeeded. The sanitized result reported 39 text models across the Claude, GPT, Gemini, DeepSeek, GLM, and Grok families. It included these catalog-verified candidates: `gpt-6-astra`, `gpt-5.6-sol`, `gemini-3.8-flash`, `gemini-3.6-flash`, `deepseek-v4-pro`, `deepseek-v4-flash`, `glm-5.3`, and `grok-4.6`.

A direct no-credential reachability check found that `api.teamorouter.cn/v1/models` returns the expected HTTP 401, proving that the Qingdao network path reaches the official endpoint. The legacy `api.teamorouter.com` path resets its connection from Qingdao. The production registry still stored the legacy `.com` base URL and the application forced that host through a local SOCKS tunnel whose listener no longer exists. This combination is the confirmed N3 `PROVIDER_UNAVAILABLE` root cause.

## Planned implementation boundary

The repair canonicalizes only the retired `.com` Teamorouter OpenAI base URL to `.cn`, keeps legacy SOCKS behavior only for un-migrated `.com` rows, migrates existing Teamorouter rows to the official base URL, and stores the existing credential as the runtime reference `env:EXTERNAL_LLM_API_KEY` instead of copying it into new model records. It registers GPT-6 Astra, Gemini 3.8 Flash, DeepSeek V4 Pro/Flash, GLM-5.3, and Grok-4.6 as active candidates. **The synchronization never changes `isDefault`**: newly inserted rows are non-default, while any pre-existing candidate preserves its existing default state. No user file, product data, or model completion is involved in catalog synchronization.

## Production remediation and approved health check

The endpoint/catalog release was deployed to Qingdao using a no-migration atomic `dist` switch. The web, worker, and scheduler services were all active, local HTTP returned 200, and the three runtime entrypoint hashes matched the verified build.

The governed catalog synchronization then succeeded through the administrator-only application route. It migrated every legacy `.com` Teamorouter record to `https://api.teamorouter.cn/v1`, found zero remaining legacy endpoint rows, and confirmed that all six catalog candidates reference only `env:EXTERNAL_LLM_API_KEY`. The existing default designation on DeepSeek V4 Pro was preserved; the sync operation did not alter any default route.

The first implementation covered the recoverable Skill Runner but not the generic `emperor.run.run` route. That route would have treated the environment reference as a literal Bearer credential. A focused hotfix made that route resolve the controlled reference, canonicalize the retired endpoint, and apply the same legacy-only SOCKS guard. It was also deployed via a no-migration atomic switch and passed the same service/HTTP/hash checks.

With explicit approval, exactly one N3 synthetic health run was then executed through `emperor.run.run` against `analysis.rufus.attribute`. The persisted run succeeded over the external governed route using model `gpt-5.5`, with 5,347 input tokens, 130 output tokens, and a 15,263 ms duration. The input was synthetic-only; no user file was uploaded, parsed, read, retried, or associated with the run, and no AI Job, acquisition job, Provider Run, keyword task, or Heartbeat was created. The application records provider token counts but uses dynamic Teamorouter billing, so this record does not claim a static dollar amount.
