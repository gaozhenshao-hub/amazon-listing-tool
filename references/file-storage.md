## ☁️ File Storage

Use the preconfigured storage helpers in `server/storage.ts`. Credentials are injected from the platform (no manual setup required). Files are stored securely and served via the built-in `/manus-storage/` path — no manual URL management needed.

```ts
import { storagePut } from "./server/storage";

// Upload bytes to storage
const fileKey = `${userId}-files/${fileName}.png`
const { key, url } = await storagePut(
  fileKey,
  fileBuffer, // Buffer | Uint8Array | string
  "image/png"
);
// url = "/manus-storage/{key}" — use directly in frontend code
// key = unique storage key — save in database
```

Tips
- Save the `key` or `url` in your database; use storage for the actual file bytes. This applies to all files including images, documents, and media.
- For file uploads, have the client POST to your server, then call `storagePut` from your backend.
- The returned `url` (e.g. `/manus-storage/...`) is automatically served via signed redirect — no manual URL signing needed.
- To delete a file, drop its `key` from your DB and any UI references — the key is the only way to reach the object, so an unreferenced file is effectively gone. Do not implement a helper to remove the underlying object; the template's storage layer does not expose a delete endpoint.
