import { getLoginUrl } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath = getLoginUrl() } =
    options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    // Retry on 503/network errors (Cloud Run cold start can take 5-10s)
    retry: (failureCount, error) => {
      if (error instanceof TRPCClientError) {
        const msg = error.message || '';
        // Retry on service unavailable, network errors, and non-JSON responses
        if (
          msg.includes('Service Unavailable') ||
          msg.includes('服务暂时不可用') ||
          msg.includes('请求超时') ||
          msg.includes('Unexpected token') ||
          msg.includes('not valid JSON') ||
          msg.includes('Failed to fetch') ||
          msg.includes('NetworkError') ||
          msg.includes('正在重试')
        ) {
          return failureCount < 4; // Up to 4 retries for cold start
        }
      }
      return false; // Don't retry auth errors (UNAUTHORIZED etc.)
    },
    retryDelay: (attemptIndex) => Math.min(2000 * 2 ** attemptIndex, 10000),
    refetchOnWindowFocus: false,
    // Keep stale data while refetching to avoid flicker
    staleTime: 5 * 60 * 1000, // 5 minutes
  });

  const logoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });

  const logout = useCallback(async () => {
    try {
      await logoutMutation.mutateAsync();
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      utils.auth.me.setData(undefined, null);
      await utils.auth.me.invalidate();
    }
  }, [logoutMutation, utils]);

  const state = useMemo(() => {
    localStorage.setItem(
      "manus-runtime-user-info",
      JSON.stringify(meQuery.data)
    );

    // Consider "loading" if the query is fetching (including retries)
    // This prevents showing the login screen while retrying after 503
    const isLoading = meQuery.isLoading || meQuery.isFetching || logoutMutation.isPending;

    return {
      user: meQuery.data ?? null,
      loading: isLoading,
      error: meQuery.error ?? logoutMutation.error ?? null,
      isAuthenticated: Boolean(meQuery.data),
    };
  }, [
    meQuery.data,
    meQuery.error,
    meQuery.isLoading,
    meQuery.isFetching,
    logoutMutation.error,
    logoutMutation.isPending,
  ]);

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (meQuery.isLoading || meQuery.isFetching || logoutMutation.isPending) return;
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (window.location.pathname === redirectPath) return;

    window.location.href = redirectPath
  }, [
    redirectOnUnauthenticated,
    redirectPath,
    logoutMutation.isPending,
    meQuery.isLoading,
    meQuery.isFetching,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
