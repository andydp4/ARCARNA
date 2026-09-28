import { useQuery } from "@tanstack/react-query";
import { getJson } from "@/lib/queryClient";
import { DEFAULT_LABEL_SETTINGS, normalizeLabelSettings, type LabelSettings } from "@shared/labelSettings";

export const LABEL_SETTINGS_QUERY_KEY = ["/api/labels/settings"] as const;

/**
 * The shop's label template settings (Settings → Labels). The defaults — what
 * labels printed before the page existed — stand in until they load, so a
 * print never waits on them.
 */
export function useLabelSettings(): LabelSettings {
  const { data } = useQuery<LabelSettings>({
    queryKey: LABEL_SETTINGS_QUERY_KEY,
    queryFn: async () => normalizeLabelSettings(await getJson("/api/labels/settings")),
    staleTime: 60_000,
  });
  return data ?? DEFAULT_LABEL_SETTINGS;
}
