import { trpc } from "@/lib/trpc";
import { APP_ERROR_CODES } from "@shared/_core/errors";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { ProjectProvider } from "./contexts/ProjectContext";
import { MarketplaceProvider } from "./contexts/MarketplaceContext";
import { getLoginUrl } from "./const";
import "./index.css";
import { ClientTransportError, isAuthRequiredError, isRetryableAppError } from "./lib/appError";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        if (isRetryableAppError(error)) return failureCount < 3;
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
    },
    mutations: {
      retry: (failureCount, error) => {
        if (isRetryableAppError(error)) return failureCount < 2;
        return false;
      },
      retryDelay: (attemptIndex) => Math.min(1500 * 2 ** attemptIndex, 6000),
    },
  },
});

// Track whether auth.me has been successfully resolved at least once
let authMeResolved = false;

const redirectToLoginIfUnauthorized = (error: unknown) => {
  if (!(error instanceof TRPCClientError)) return;
  if (typeof window === "undefined") return;

  if (!isAuthRequiredError(error)) return;

  // Don't redirect if we're already on the login page
  if (window.location.pathname === '/login') return;

  // Only redirect if auth.me has already confirmed the user is authenticated.
  // During initial page load, auth.me might still be loading/retrying (Cloud Run cold start),
  // and other protected queries firing before auth.me resolves will get UNAUTHORIZED.
  // We should NOT redirect in that case — just let them retry after auth.me succeeds.
  if (!authMeResolved) {
    console.warn("[Auth] Suppressed login redirect: auth.me not yet resolved. Query will retry after auth is ready.");
    return;
  }

  window.location.href = getLoginUrl();
};

queryClient.getQueryCache().subscribe(event => {
  // Track when auth.me successfully resolves
  if (event.type === "updated" && event.action.type === "success") {
    const queryKey = event.query.queryKey;
    // tRPC query keys are arrays like [["auth","me"], ...]
    const keyStr = JSON.stringify(queryKey);
    if (keyStr.includes('"auth"') && keyStr.includes('"me"')) {
      if (event.query.state.data) {
        authMeResolved = true;
      }
    }
  }

  if (event.type === "updated" && event.action.type === "error") {
    const error = event.query.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Query Error]", error);
  }
});

queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "error") {
    const error = event.mutation.state.error;
    redirectToLoginIfUnauthorized(error);
    console.error("[API Mutation Error]", error);
  }
});

// Also track auth.me resolution via logout (reset the flag)
queryClient.getMutationCache().subscribe(event => {
  if (event.type === "updated" && event.action.type === "success") {
    // Check if this is a logout mutation
    const mutKey = JSON.stringify(event.mutation.options.mutationKey || []);
    if (mutKey.includes('"logout"')) {
      authMeResolved = false;
    }
  }
});

const trpcClient = trpc.createClient({
  links: [
    httpBatchLink({
      url: "/api/trpc",
      transformer: superjson,
      async fetch(input, init) {
        const controller = new AbortController();
        // Determine timeout based on request type
        // AI-heavy mutations (imageWorkflow, generate, evaluate, analyze) need longer timeout
        const inputUrl = typeof input === 'string' ? input : (input as Request).url || '';
        const isAiMutation = inputUrl.includes('imageWorkflow') || 
          inputUrl.includes('generate') || 
          inputUrl.includes('evaluate') || 
          inputUrl.includes('analyze') ||
          inputUrl.includes('adDeep') ||
          inputUrl.includes('runStage') ||
          inputUrl.includes('Checklist');
        const timeoutMs = isAiMutation ? 180000 : 30000; // 180s for AI, 30s for others
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const res = await globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          // Handle 502/503 - Cloud Run cold start or overload
          if (res.status === 503 || res.status === 502) {
            throw new ClientTransportError("服务暂时不可用，正在重试...", APP_ERROR_CODES.EXTERNAL_SERVICE_FAILED, true);
          }
          // Check if response is actually JSON before returning
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json') && res.status >= 400) {
            const text = await res.text();
            throw new ClientTransportError(`服务器返回异常: ${text.substring(0, 100)}`, APP_ERROR_CODES.EXTERNAL_SERVICE_FAILED, res.status >= 500);
          }
          return res;
        } catch (err) {
          clearTimeout(timeoutId);
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new ClientTransportError("请求超时，正在重试...", APP_ERROR_CODES.REQUEST_TIMEOUT, true);
          }
          throw err;
        }
      },
    }),
  ],
});

function installAnalytics() {
  if (import.meta.env.MODE === "e2e") return;
  const endpoint = import.meta.env.VITE_ANALYTICS_ENDPOINT;
  const websiteId = import.meta.env.VITE_ANALYTICS_WEBSITE_ID;
  if (!endpoint || !websiteId) return;

  try {
    const script = document.createElement("script");
    script.defer = true;
    script.src = new URL("umami", endpoint.endsWith("/") ? endpoint : `${endpoint}/`).toString();
    script.dataset.websiteId = websiteId;
    document.head.appendChild(script);
  } catch (error) {
    console.warn("[Analytics] Invalid VITE_ANALYTICS_ENDPOINT; analytics disabled.", error);
  }
}

installAnalytics();

const application = (
  <ProjectProvider>
    <MarketplaceProvider>
      <App />
    </MarketplaceProvider>
  </ProjectProvider>
);

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>{application}</QueryClientProvider>
  </trpc.Provider>,
);
