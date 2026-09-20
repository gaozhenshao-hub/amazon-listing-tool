# GPT-6 model-list visibility finding — 2026-09-20

The supplied Emperor AI model management screenshot was inspected in five ordered, overlapping horizontal crops from `/home/ubuntu/upload/pasted_file_D36wWa_image.png`. It shows the Emperor **模型路由** page with **39 registered models**, **34 running**, and the model list sorted by the existing backend rule: default models first, followed by `name ASC`.

The visible first rows are the default `TeamoRouter DeepSeek V4 Pro`, followed by alphabetically ordered Claude entries. GPT-6 Astra is not visible in the first viewport because its registered display name is `TeamoRouter GPT-6 Astra`, which sorts after the Claude entries in the existing list. The screenshot’s right-side crop confirms the `同步 TeamoRouter` control and Teamorouter capability tags are already present.

Production database verification independently confirms `teamo-gpt-6-astra` exists in `emperor_model_providers` with `modelId=gpt-6-astra`, `isActive=true`, `isDefault=false`, base URL `https://api.teamorouter.cn/v1`, and an environment-only credential reference. The new UI search/quick-filter release adds `GPT-6` and `Teamorouter` shortcuts to make this entry immediately discoverable without changing routing or producing a model call.

A subsequent no-migration UI release prioritizes the model list as follows: existing default models first, then Teamorouter catalog candidates, then the remaining models by name. This keeps the default route unchanged while placing GPT-6 Astra in the first visible Teamorouter group. The release completed with all three services active and local HTTP 200; it did not issue a model request.
