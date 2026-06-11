import { trpc } from "@/lib/trpc";
import { UNAUTHED_ERR_MSG } from '@shared/const';
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink, TRPCClientError } from "@trpc/client";
import { createRoot } from "react-dom/client";
import superjson from "superjson";
import App from "./App";
import { ProjectProvider } from "./contexts/ProjectContext";
import { MarketplaceProvider } from "./contexts/MarketplaceContext";
import { getLoginUrl } from "./const";
import "./index.css";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: (failureCount, error) => {
        // Retry on 503 Service Unavailable (cold start) up to 3 times
        if (error instanceof TRPCClientError) {
          const msg = error.message || '';
          if (msg.includes('Service Unavailable') || msg.includes('Unexpected token') || msg.includes('not valid JSON') || msg.includes('Failed to fetch') || msg.includes('服务暂时不可用') || msg.includes('请求超时') || msg.includes('正在重试')) {
            return failureCount < 3;
          }
        }
        return failureCount < 1;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 8000),
    },
    mutations: {
      retry: (failureCount, error) => {
        if (error instanceof TRPCClientError) {
          const msg = error.message || '';
          if (msg.includes('Service Unavailable') || msg.includes('Unexpected token') || msg.includes('not valid JSON') || msg.includes('Failed to fetch') || msg.includes('服务暂时不可用') || msg.includes('请求超时') || msg.includes('正在重试')) {
            return failureCount < 2;
          }
        }
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

  const isUnauthorized = error.message === UNAUTHED_ERR_MSG;
  if (!isUnauthorized) return;

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
        // 30s timeout for all requests (Cloud Run can be slow on cold start)
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        try {
          const res = await globalThis.fetch(input, {
            ...(init ?? {}),
            credentials: "include",
            signal: controller.signal,
          });
          clearTimeout(timeoutId);
          // Handle 502/503 - Cloud Run cold start or overload
          if (res.status === 503 || res.status === 502) {
            throw new TRPCClientError('服务暂时不可用，正在重试...');
          }
          // Check if response is actually JSON before returning
          const contentType = res.headers.get('content-type') || '';
          if (!contentType.includes('application/json') && res.status >= 400) {
            const text = await res.text();
            throw new TRPCClientError(`服务器返回异常: ${text.substring(0, 100)}`);
          }
          return res;
        } catch (err) {
          clearTimeout(timeoutId);
          if (err instanceof DOMException && err.name === 'AbortError') {
            throw new TRPCClientError('请求超时，正在重试...');
          }
          throw err;
        }
      },
    }),
  ],
});

createRoot(document.getElementById("root")!).render(
  <trpc.Provider client={trpcClient} queryClient={queryClient}>
    <QueryClientProvider client={queryClient}>
      <ProjectProvider>
        <MarketplaceProvider>
          <App />
        </MarketplaceProvider>
      </ProjectProvider>
    </QueryClientProvider>
  </trpc.Provider>
);
