## Manus OAuth

**Key Rule:** When handling redirect URLs, always use `window.location.origin` and never hardcode domains or use `req.host`. This is because the frontend and the backend are deployed on separate servers. The server cannot reliably determine the frontend's origin and so the frontend must always pass it explicitly.

**Unsupported browsers:**
- Safari Private Browsing (blocks all cookies)
- Firefox with Enhanced Tracking Protection (Strict)
- Brave with Shields (Aggressive)
- Any browser with "Block all cookies" enabled

Manus OAuth requires cookies to maintain session state. If a user's browser blocks cookies, authentication will not work.

**Anti-patterns:**
```ts
// ❌ Guessing the URL doesn't allow you to redirect to the actual domain that the user is using
const appId = process.env.VITE_APP_ID || "";
const prefix = appId.substring(0, 8);
const baseUrl = `https://myapp-${prefix}.manus.space`;
const invitationUrl = `${baseUrl}/invite/${token}`;

// ❌ Same thing here, we should make sure that this information is preserved
const url = `https://${projectName}.manus.space/callback`;

// ❌ Setting subdomains here risks a chance of the env var being out of date.
const url = `https://${process.env.APP_SUBDOMAIN}.example.com/verify`;
```

The only correct approach: Frontend passes `window.location.origin` to the backend.

## Determining the URL

On the frontend, use `window.location.origin`:

```ts
// ✅ Always use window.location.origin
const frontendUrl = window.location.origin;
// Returns: "https://myapp.manus.space" (no trailing slash)

// For specific paths
const callbackUrl = `${window.location.origin}/api/oauth/callback`;
// Returns: "https://myapp.manus.space/api/oauth/callback"
```

On the backend, it's recommended to pass this as state:

```ts
// Frontend: Include origin in state when initiating login
export const getLoginUrl = (returnPath?: string) => {
  const redirectUrl = `${window.location.origin}/api/oauth/callback`;

  // Encode origin and return path in state
  const state = JSON.stringify({
    origin: window.location.origin,
    returnPath: returnPath || "/",
  });

  const params = new URLSearchParams({
    app_id: APP_ID,
    redirect_url: redirectUrl,
    state: state,
  });

  return `${OAUTH_PORTAL_URL}/login?${params.toString()}`;
};
```

You can then parse this out using the `req.query` from the state:

```ts
// Backend: Extract origin from state in the callback
router.get("/api/oauth/callback", async (req, res) => {
  const { code, state } = req.query;

  // Parse the state to get frontend origin
  const { origin, returnPath } = JSON.parse(state as string);

  // Exchange code for token and set cookie
  const token = await exchangeCodeForToken(code);
  res.cookie(COOKIE_NAME, token, cookieOptions);

  // ✅ Redirect using the origin from state
  res.redirect(`${origin}${returnPath}`);
});
```

## Generating Invite URLs / Redirect URLs

When the backend needs to generate URLs (magic links, invitations, email verification), the frontend must pass its origin in the request.

```ts
// Frontend: Pass origin in tRPC calls
const createInvite = trpc.invites.create.useMutation();
await createInvite.mutateAsync({
  eventId: "123",
  origin: window.location.origin, // ✅ Always pass this
});
```

This ensures that the backend knows where to redirect the user after the invite is accepted.

```ts
// Backend: Use the passed origin
createInvite: protectedProcedure
  .input(z.object({
    eventId: z.string(),
    origin: z.string().url(),
  }))
  .mutation(async ({ input }) => {
    const { eventId, origin } = input;
    const token = generateToken();

    // ✅ Use the origin passed from frontend
    const inviteUrl = `${origin}/events/${eventId}/join?token=${token}`;

    return { inviteUrl };
  }),
```
