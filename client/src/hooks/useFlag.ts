import { useQuery } from "@tanstack/react-query";
import { getQueryFn } from "@/lib/queryClient";

type FeatureFlagsResponse = {
  flags: Array<{ flag: string; enabled: boolean }>;
};

const STALE_MS = 60_000;

export function useFlag(flagName: string): { enabled: boolean; isLoading: boolean } {
  const { data, isLoading } = useQuery<FeatureFlagsResponse>({
    queryKey: ["/api/feature-flags"],
    queryFn: getQueryFn({ on401: "throw" }),
    staleTime: STALE_MS,
    refetchOnWindowFocus: true,
  });

  const row = data?.flags?.find((f) => f.flag === flagName);
  return {
    enabled: row?.enabled ?? false,
    isLoading,
  };
}
