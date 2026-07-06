## Image Generation Integration

Use the preconfigured image generation helper that connects to the internal ImageService, no manual setup required.

Example usage:
```ts
import { generateImage } from "./server/_core/imageGeneration.ts";

const { url: imageUrl } = await generateImage({
  prompt: "A serene landscape with mountains"
});
// For editing:
const { url: imageUrl } = await generateImage({
  prompt: "Add a rainbow to this landscape",
  originalImages: [{
    url: "https://example.com/original.jpg",
    mimeType: "image/jpeg"
  }]
});
```

### Selecting a model

`generateImage()` defaults to **GPT Image 2** (`MODEL_GPT_IMAGE_2`) at `medium` quality. Pass `model` and/or `quality` to override:

```ts
const { url: imageUrl } = await generateImage({
  prompt: "A neon cyberpunk city at night",
  model: "MODEL_GPT_IMAGE_2",
  quality: "high",
});
```

When selecting a different model, omit `quality` unless that model supports the value you want to send.

### Listing available models

```ts
import { listImageModels } from "./server/_core/imageGeneration.ts";

const { models } = await listImageModels();
// e.g. [{ model: "MODEL_GPT_IMAGE_2", id: "gpt-image-2" }, ...]
```

Feed a `model` value from this list into `generateImage({ model })`.

Tips
- Always call from server-side code (e.g., inside tRPC procedures) to avoid exposing API keys
- Image generation can take 5-20 seconds, implement proper loading states
- Implement proper error handling as image generation can fail
