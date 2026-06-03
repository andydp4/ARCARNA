import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
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
  COMMAND_PALETTE_SECTION_LABELS,
  ensurePaletteData,
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
    void ensurePaletteData(queryClient).then(() => {
      if (!cancelled) setIndexVersion((v) => v + 1);
    });
    return () => {
      cancelled = true;
    };
  }, [open, queryClient]);

  const items = useMemo(
    () => buildCommandPaletteIndex(queryClient, user?.role, user?.id),
    [queryClient, user?.role, user?.id, indexVersion, open],
  );

  const grouped = useMemo(() => groupItems(items), [items]);

  const handleSelect = useCallback(
    (item: CommandPaletteItem) => {
      recordPaletteSelection(user?.id, item.id);
      setOpen(false);
      if (item.href) setLocation(item.href);
    },
    [setLocation, user?.id],
  );

  if (!isAuthenticated) return null;

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search pages, customers, products, orders, actions…" />
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
                      value={[item.label, item.subtext, item.id].filter(Boolean).join(" ")}
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
