import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import type { ApiOrderRow } from "@/lib/orderTypes";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/ui/command";
import { useAuth } from "@/hooks/useAuth";
import { useGlobalShortcut } from "@/hooks/useGlobalShortcut";
import {
  buildCommandPaletteIndex,
  buildOrderItems,
  COMMAND_PALETTE_SECTION_LABELS,
  ensurePaletteData,
  getRecentPaletteIds,
  recordPaletteSelection,
  type CommandPaletteItem,
  type CommandPaletteSection,
} from "@/lib/commandPaletteIndex";
import {
  Package,
  PackageCheck,
  Sparkles,
  User,
  type LucideIcon,
} from "lucide-react";

const SECTION_ORDER: CommandPaletteSection[] = [
  "pages",
  "customers",
  "products",
  "orders",
  "actions",
];

const SECTION_FALLBACK_ICONS: Record<CommandPaletteSection, LucideIcon> = {
  pages: Sparkles,
  customers: User,
  products: Package,
  orders: PackageCheck,
  actions: Sparkles,
};

function groupItems(items: CommandPaletteItem[]): Map<CommandPaletteSection, CommandPaletteItem[]> {
  const grouped = new Map<CommandPaletteSection, CommandPaletteItem[]>();
  for (const section of SECTION_ORDER) grouped.set(section, []);
  for (const item of items) grouped.get(item.section)?.push(item);
  return grouped;
}

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [indexVersion, setIndexVersion] = useState(0);
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  const { user, isAuthenticated } = useAuth();

  const openPalette = useCallback(() => setOpen(true), []);

  useGlobalShortcut({ enabled: isAuthenticated, onTrigger: openPalette });

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    void ensurePaletteData(queryClient, user?.role).then(() => {
      if (!cancelled) setIndexVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open, queryClient, user?.role]);

  // Orders come from the server's search, inside the caller's history bound
  // (Q10a, CMP-06), a moment after typing stops.
  const [search, setSearch] = useState("");
  const [term, setTerm] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setTerm(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const { data: foundOrders } = useQuery<ApiOrderRow[]>({
    queryKey: ["/api/orders/search", term],
    // POST: a typed phone number stays out of the URL and the access logs.
    queryFn: async () => (await apiRequest("POST", "/api/orders/search", { q: term })).json() as Promise<ApiOrderRow[]>,
    enabled: open && term.length >= 2,
    staleTime: 0,
    gcTime: 0,
  });

  const items = useMemo(() => {
    const base = buildCommandPaletteIndex(queryClient, user?.role, user?.id);
    const orders = term.length >= 2 && foundOrders
      ? buildOrderItems(foundOrders, getRecentPaletteIds(user?.id)).map((item) => ({ ...item, keywords: term }))
      : [];
    return [...base, ...orders];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryClient, user?.role, user?.id, indexVersion, open, foundOrders, term]);

  const grouped = useMemo(() => groupItems(items), [items]);

  const handleSelect = useCallback(
    (item: CommandPaletteItem) => {
      recordPaletteSelection(user?.id, item.id);
      setOpen(false);
      if (item.href) setLocation(item.href);
    },
    [setLocation, user?.id],
  );

  if (!isAuthenticated || user?.role === "CUSTOMER") return null;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput
        placeholder="Search pages, customers, products, orders, actions…"
        value={search}
        onValueChange={setSearch}
      />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        {SECTION_ORDER.map((section, sectionIndex) => {
          const sectionItems = grouped.get(section) ?? [];
          if (sectionItems.length === 0) return null;
          return (
            <div key={section}>
              {sectionIndex > 0 && <CommandSeparator />}
              <CommandGroup heading={COMMAND_PALETTE_SECTION_LABELS[section]}>
                {sectionItems.map((item) => {
                  const Icon = item.icon ?? SECTION_FALLBACK_ICONS[section];
                  return (
                    <CommandItem
                      key={item.id}
                      value={[item.label, item.subtext, item.keywords, item.id].filter(Boolean).join(" ")}
                      onSelect={() => handleSelect(item)}
                    >
                      <Icon className="opacity-70" />
                      <span className="flex min-w-0 flex-1 flex-col">
                        <span>{item.label}</span>
                        {item.subtext ? (
                          <span className="truncate text-xs text-muted-foreground">{item.subtext}</span>
                        ) : null}
                      </span>
                    </CommandItem>
                  );
                })}
              </CommandGroup>
            </div>
          );
        })}
      </CommandList>
      <div className="flex items-center justify-end border-t px-3 py-2 text-xs text-muted-foreground">
        <span>Navigate</span>
        <CommandShortcut className="ml-2">↵</CommandShortcut>
        <span className="ml-4">Close</span>
        <CommandShortcut className="ml-2">Esc</CommandShortcut>
      </div>
    </CommandDialog>
  );
}
