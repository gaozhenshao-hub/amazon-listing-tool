## LLM Integration

Use the preconfigured LLM helpers. Credentials are injected from the platform (no manual setup required).

```ts
import { invokeLLM } from "./server/_core/llm";

/**
 * Simple chat completion
 * type Role = "system" | "user" | "assistant" | "tool" | "function";
 * type TextContent = {
 *   type: "text";
 *   text: string;
 * };
 *
 * type ImageContent = {
 *   type: "image_url";
 *   image_url: {
 *     url: string;
 *     detail?: "auto" | "low" | "high";
 *   };
 * };
 *
 * type FileContent = {
 *   type: "file_url";
 *   file_url: {
 *     url: string;
 *     mime_type?: "audio/mpeg" | "audio/wav" | "application/pdf" | "audio/mp4" | "video/mp4" ;
 *   };
 * };
 *
 * export type Message = {
 *   role: Role;
 *   content: string | Array<ImageContent | TextContent | FileContent>
 * };
 *
 * Supported parameters:
 * messages: Array<{
 *   role: 'system' | 'user' | 'assistant' | 'tool',
 *   content: string | { tool_call: { name: string, arguments: string } }
 * }>
 * tool_choice?: 'none' | 'auto' | 'required' | { type: 'function', function: { name: string } }
 * tools?: Tool[]
 */
const response = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "Hello, world!" },
  ],
});
```

Tips
- Always call llm functions from server-side code (e.g., inside tRPC procedures), to avoid exposing your API key.
- LLM calls deduct from this project's credit balance.
- All models support streaming, but `invokeLLM()` doesn't expose `stream` — modify the helper to pass `stream: true` and parse the SSE response if you need it. When proxying SSE, listen on `res` close (not `req`) and guard with a `finished` flag, or the upstream gets aborted after the first event.
- LLM responses often contain markdown. Use `<Streamdown>{content}</Streamdown>` (imported from `streamdown`) to render markdown content with proper formatting and streaming support.

### Listing Available Models

```ts
import { listLLMModels } from "./server/_core/llm";

const { data } = await listLLMModels();
const ids = data.map(m => m.id);
```

Returns OpenAI-standard model metadata for each available ID. From the project shell you can also peek at it directly: `curl "$BUILT_IN_FORGE_API_URL/v1/models" -H "Authorization: Bearer $BUILT_IN_FORGE_API_KEY"`.

**Combine with `invokeLLM`** to discover IDs at runtime instead of hardcoding:

```ts
import { invokeLLM, listLLMModels } from "./server/_core/llm";

const { data } = await listLLMModels();
const model = data.find(m => m.id.startsWith("claude-"))?.id;

const response = await invokeLLM({
  model,
  messages: [{ role: "user", content: "Hello" }],
});
```

### Thinking / Reasoning

`invokeLLM()` forwards `thinking` and `reasoning` extension params unchanged (no defaults). Per model family:

- OpenAI gpt-5 family — `reasoning: { effort: "minimal" | "low" | "medium" | "high" }`
- Anthropic claude family — `thinking: { type: "enabled", budget_tokens: 2048 }`
- Google gemini family — `thinking: { budget_tokens: 1024 }`

```ts
await invokeLLM({
  model: "claude-sonnet-4-6",
  messages: [...],
  thinking: { type: "enabled", budget_tokens: 2048 },
});

await invokeLLM({
  model: "gpt-5",
  messages: [...],
  reasoning: { effort: "low" },
});
```

For the exact shape per model, check `capabilities.thinking_example` from the `/models` catalog (see Tips above).

### Structured Responses (JSON Schema)

Ask the model to return structured JSON via `response_format`:

```ts
import { invokeLLM } from "./server/_core/llm";

const structured = await invokeLLM({
  messages: [
    { role: "system", content: "You are a helpful assistant designed to output JSON." },
    { role: "user", content: "Extract the name and age from the following text: \"My name is Alice and I am 30 years old.\"" },
  ],
  response_format: {
    type: "json_schema",
    json_schema: {
      name: "person_info",
      strict: true,
      schema: {
        type: "object",
        properties: {
          name: { type: "string", description: "The name of the person" },
          age: { type: "integer", description: "The age of the person" },
        },
        required: ["name", "age"],
        additionalProperties: false,
      },
    },
  },
});

// The model responds with JSON content matching the schema.
// Access via `structured.choices[0].message.content` and JSON.parse if needed.
```
The helpers mirror the Python SDK semantics but produce JavaScript-first code, keeping credentials inside the server and ensuring every environment has access to the same token.
