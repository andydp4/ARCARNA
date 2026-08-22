import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  ArrowDown,
  ArrowUp,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  ImagePlus,
  LayoutTemplate,
  Palette,
  Plus,
  Save,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { apiRequest, getJson, queryClient } from "@/lib/queryClient";
import { resolveAppPath } from "@/lib/appPaths";
import { useToast } from "@/hooks/use-toast";
import { PageHeader, LM_CARD } from "@/components/PageHeader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  blockCssVars,
  buildFallbackBlocks,
  fallbackOrderSettings,
  fallbackWebsiteTheme,
  themeCssVars,
  type PublicSiteConfig,
  type PublicWebsiteBlock,
  type PublicWebsiteTheme,
  type WebsiteBlockType,
} from "@/features/wm-supplies/publicWebsite";
import {
  WEBSITE_BLOCK_TYPE_OPTIONS,
  WEBSITE_ORDER_ACCESS_MODE_OPTIONS,
  WEBSITE_ORDER_STATUS_OPTIONS,
  blockDraftToPayload,
  blockToDraft,
  defaultWebsiteBlockDraft,
  defaultWebsiteMediaDraft,
  mediaDraftToPayload,
  nextBlockSortOrder,
  orderSettingsDraftToPayload,
  orderSettingsToDraft,
  themeDraftToPayload,
  type WebsiteBlockDraft,
  type WebsiteMediaDraft,
  type WebsiteOrderSettingsDraft,
  type WebsiteUploadItem,
} from "@/features/wm-supplies/adminWebsite";

const WEBSITE_CONFIG_QUERY = ["/api/website/config?page=home"] as const;
const WEBSITE_UPLOADS_QUERY = ["/api/website/uploads"] as const;
const NO_IMAGE = "__none__";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "The website change could not be saved";
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return "0 KB";
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.ceil(value / 1024)} KB`;
}

function StatusBadge({ enabled }: { enabled: boolean }) {
  return enabled ? (
    <Badge className="border-emerald-500/30 bg-emerald-500/15 text-emerald-100">Visible</Badge>
  ) : (
    <Badge variant="outline" className="border-metal-edge text-metal-muted">Hidden</Badge>
  );
}

function ColorField({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={id}>{label}</Label>
      <div className="flex min-w-0 gap-2">
        <Input
          id={id}
          type="color"
          value={value || "#111111"}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-14 shrink-0 p-1"
        />
        <Input
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder="#111111"
          className="min-w-0"
        />
      </div>
    </div>
  );
}

function PublicPreview({ config }: { config: PublicSiteConfig }) {
  const blocks = config.blocks.length > 0 ? config.blocks : buildFallbackBlocks(config.theme);

  return (
    <div
      className="overflow-hidden rounded-lg border border-metal-edge bg-black"
      style={themeCssVars(config.theme)}
    >
      <div className="flex items-center justify-between border-b border-[var(--wm-border)] px-4 py-3 text-[var(--wm-text)]">
        <span className="min-w-0 truncate text-sm font-semibold">{config.theme.siteName}</span>
        <span className="text-xs opacity-70">wm-supplies</span>
      </div>
      <div className="max-h-[520px] overflow-y-auto">
        {blocks.slice(0, 6).map((block) => (
          <section
            key={block.id}
            className="min-h-[132px] border-b border-[var(--wm-block-border)] p-4"
            style={blockCssVars(block, config.theme)}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 space-y-2 text-[var(--wm-block-text)]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-xs uppercase">{block.type}</span>
                  {!block.isVisible ? <StatusBadge enabled={false} /> : null}
                </div>
                <h3 className="break-words text-xl font-semibold">
                  {block.title || "Untitled block"}
                </h3>
                {block.subtitle ? <p className="text-sm opacity-80">{block.subtitle}</p> : null}
                {block.body ? <p className="max-w-2xl text-sm leading-6 opacity-80">{block.body}</p> : null}
              </div>
              {block.image?.url ? (
                <img
                  src={block.image.url}
                  alt={block.image.altText ?? ""}
                  className="h-24 w-32 shrink-0 rounded-md border border-[var(--wm-block-border)] object-cover"
                />
              ) : null}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}

function OverviewStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-md border border-metal-edge bg-metal-charcoal/35 p-4">
      <div className="text-2xl font-semibold text-metal-warm-white">{value}</div>
      <div className="mt-1 text-sm text-metal-muted">{label}</div>
    </div>
  );
}

function BlockListRow({
  block,
  selected,
  canMoveUp,
  canMoveDown,
  busy,
  onSelect,
  onMove,
  onToggle,
  onDuplicate,
  onDelete,
}: {
  block: PublicWebsiteBlock;
  selected: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  busy: boolean;
  onSelect: () => void;
  onMove: (direction: "up" | "down") => void;
  onToggle: (visible: boolean) => void;
  onDuplicate: () => void;
  onDelete: () => void;
}) {
  return (
    <div
      className={`rounded-md border p-3 transition-colors ${
        selected
          ? "border-metal-warm-white bg-metal-charcoal/70"
          : "border-metal-edge bg-metal-charcoal/25"
      }`}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <button
          type="button"
          onClick={onSelect}
          className="min-w-0 text-left"
          data-testid={`website-block-select-${block.id}`}
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="truncate text-sm font-semibold text-metal-warm-white">
              {block.title || "Untitled block"}
            </span>
            <Badge variant="outline" className="border-metal-edge text-xs text-metal-muted">
              {block.type}
            </Badge>
            <StatusBadge enabled={block.isVisible} />
          </div>
          <div className="mt-1 text-xs text-metal-muted">Sort {block.sortOrder}</div>
        </button>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canMoveUp || busy}
            onClick={() => onMove("up")}
            aria-label="Move block up"
          >
            <ArrowUp className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={!canMoveDown || busy}
            onClick={() => onMove("down")}
            aria-label="Move block down"
          >
            <ArrowDown className="h-4 w-4" />
          </Button>
          <Switch
            checked={block.isVisible}
            disabled={busy}
            onCheckedChange={onToggle}
            aria-label={block.isVisible ? "Hide block" : "Show block"}
          />
          <Button
            type="button"
            variant="outline"
            size="icon"
            disabled={busy}
            onClick={onDuplicate}
            aria-label="Duplicate block"
          >
            <Copy className="h-4 w-4" />
          </Button>
          <Button
            type="button"
            variant="destructive"
            size="icon"
            disabled={busy}
            onClick={onDelete}
            aria-label="Delete block"
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}

export default function WmSuppliesWebsiteSettingsPage() {
  const { toast } = useToast();
  const [activeTab, setActiveTab] = useState("overview");
  const [themeDraft, setThemeDraft] = useState<PublicWebsiteTheme>(fallbackWebsiteTheme);
  const [orderDraft, setOrderDraft] = useState<WebsiteOrderSettingsDraft>(
    orderSettingsToDraft(fallbackOrderSettings),
  );
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null);
  const [isNewBlock, setIsNewBlock] = useState(true);
  const [blockDraft, setBlockDraft] = useState<WebsiteBlockDraft>(defaultWebsiteBlockDraft());
  const [mediaDraft, setMediaDraft] = useState<WebsiteMediaDraft>(defaultWebsiteMediaDraft());

  const configQuery = useQuery({
    queryKey: WEBSITE_CONFIG_QUERY,
    queryFn: () => getJson<PublicSiteConfig>(WEBSITE_CONFIG_QUERY[0]),
  });
  const uploadsQuery = useQuery({
    queryKey: WEBSITE_UPLOADS_QUERY,
    queryFn: () => getJson<WebsiteUploadItem[]>(WEBSITE_UPLOADS_QUERY[0]),
  });

  const config = configQuery.data;
  const uploads = uploadsQuery.data ?? [];
  const sortedBlocks = useMemo(
    () => [...(config?.blocks ?? [])].sort((a, b) => a.sortOrder - b.sortOrder),
    [config?.blocks],
  );
  const selectedBlock = sortedBlocks.find((block) => block.id === selectedBlockId) ?? null;

  useEffect(() => {
    if (config?.theme) setThemeDraft(config.theme);
    if (config?.orderSettings) setOrderDraft(orderSettingsToDraft(config.orderSettings));
  }, [config?.theme, config?.orderSettings]);

  useEffect(() => {
    if (isNewBlock) return;
    if (selectedBlock) {
      setBlockDraft(blockToDraft(selectedBlock));
      return;
    }
    if (sortedBlocks.length > 0) {
      setSelectedBlockId(sortedBlocks[0].id);
    } else {
      setIsNewBlock(true);
      setSelectedBlockId(null);
      setBlockDraft(defaultWebsiteBlockDraft(nextBlockSortOrder(config)));
    }
  }, [config, isNewBlock, selectedBlock, sortedBlocks]);

  function invalidateWebsiteData() {
    void queryClient.invalidateQueries({ queryKey: WEBSITE_CONFIG_QUERY });
    void queryClient.invalidateQueries({ queryKey: WEBSITE_UPLOADS_QUERY });
  }

  const onMutationError = (error: unknown) => {
    toast({
      title: "Website update failed",
      description: errorMessage(error),
      variant: "destructive",
    });
  };

  const themeMutation = useMutation({
    mutationFn: () => apiRequest("PUT", "/api/website/theme", themeDraftToPayload(themeDraft)),
    onSuccess: () => {
      invalidateWebsiteData();
      toast({ title: "Theme saved", description: "WM Supplies theme updated" });
    },
    onError: onMutationError,
  });

  const orderMutation = useMutation({
    mutationFn: () =>
      apiRequest("PUT", "/api/website/order-settings", orderSettingsDraftToPayload(orderDraft)),
    onSuccess: () => {
      invalidateWebsiteData();
      toast({ title: "Ordering saved", description: "Website order settings updated" });
    },
    onError: onMutationError,
  });

  const blockMutation = useMutation({
    mutationFn: async () => {
      const payload = blockDraftToPayload(blockDraft);
      const response = isNewBlock
        ? await apiRequest("POST", "/api/website/blocks", payload)
        : await apiRequest("PUT", `/api/website/blocks/${selectedBlockId}`, payload);
      return (await response.json()) as { id: string };
    },
    onSuccess: (block) => {
      setIsNewBlock(false);
      setSelectedBlockId(block.id);
      invalidateWebsiteData();
      toast({ title: "Block saved", description: "Website content block updated" });
    },
    onError: onMutationError,
  });

  const blockActionMutation = useMutation({
    mutationFn: async ({
      action,
      block,
      visible,
      direction,
    }: {
      action: "toggle" | "duplicate" | "delete" | "move";
      block: PublicWebsiteBlock;
      visible?: boolean;
      direction?: "up" | "down";
    }) => {
      if (action === "toggle") {
        await apiRequest("PUT", `/api/website/blocks/${block.id}`, { isVisible: Boolean(visible) });
        return;
      }
      if (action === "duplicate") {
        await apiRequest("POST", `/api/website/blocks/${block.id}/duplicate`);
        return;
      }
      if (action === "delete") {
        await apiRequest("DELETE", `/api/website/blocks/${block.id}`);
        return;
      }
      const index = sortedBlocks.findIndex((entry) => entry.id === block.id);
      const target = sortedBlocks[direction === "up" ? index - 1 : index + 1];
      if (!target) return;
      await apiRequest("PUT", `/api/website/blocks/${block.id}`, {
        sortOrder: target.sortOrder,
      });
      await apiRequest("PUT", `/api/website/blocks/${target.id}`, {
        sortOrder: block.sortOrder,
      });
    },
    onSuccess: () => {
      invalidateWebsiteData();
      toast({ title: "Block updated", description: "Website block action complete" });
    },
    onError: onMutationError,
  });

  const mediaMutation = useMutation({
    mutationFn: () =>
      apiRequest("POST", "/api/website/uploads/metadata", mediaDraftToPayload(mediaDraft)),
    onSuccess: () => {
      setMediaDraft(defaultWebsiteMediaDraft());
      invalidateWebsiteData();
      toast({ title: "Media saved", description: "Website image metadata added" });
    },
    onError: onMutationError,
  });

  const isBusy =
    themeMutation.isPending ||
    orderMutation.isPending ||
    blockMutation.isPending ||
    blockActionMutation.isPending ||
    mediaMutation.isPending;

  const visibleBlocks = sortedBlocks.filter((block) => block.isVisible);
  const publicUrl = resolveAppPath("/");

  function startNewBlock(type: WebsiteBlockType = "hero") {
    setIsNewBlock(true);
    setSelectedBlockId(null);
    setBlockDraft({
      ...defaultWebsiteBlockDraft(nextBlockSortOrder(config)),
      type,
    });
    setActiveTab("blocks");
  }

  function setBlockDraftField<K extends keyof WebsiteBlockDraft>(
    key: K,
    value: WebsiteBlockDraft[K],
  ) {
    setBlockDraft((draft) => ({ ...draft, [key]: value }));
  }

  function setOrderDraftField<K extends keyof WebsiteOrderSettingsDraft>(
    key: K,
    value: WebsiteOrderSettingsDraft[K],
  ) {
    setOrderDraft((draft) => ({ ...draft, [key]: value }));
  }

  function setThemeDraftField<K extends keyof PublicWebsiteTheme>(
    key: K,
    value: PublicWebsiteTheme[K],
  ) {
    setThemeDraft((draft) => ({ ...draft, [key]: value }));
  }

  return (
    <div className="w-full">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <PageHeader
          icon={LayoutTemplate}
          title="WM Supplies Website"
          description="Manage the customer-facing storefront content, theme, media, and order intake."
        />

        <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
          <TabsList className="grid min-h-[48px] w-full grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
            <TabsTrigger value="overview">Overview</TabsTrigger>
            <TabsTrigger value="theme">Theme</TabsTrigger>
            <TabsTrigger value="blocks">Blocks</TabsTrigger>
            <TabsTrigger value="media">Media</TabsTrigger>
            <TabsTrigger value="ordering">Ordering</TabsTrigger>
            <TabsTrigger value="preview">Preview</TabsTrigger>
          </TabsList>

          <TabsContent value="overview" className="space-y-6">
            <div className="grid gap-4 md:grid-cols-4">
              <OverviewStat label="Content blocks" value={sortedBlocks.length} />
              <OverviewStat label="Visible blocks" value={visibleBlocks.length} />
              <OverviewStat label="Media files" value={uploads.length} />
              <OverviewStat label="Order access" value={config?.orderSettings.orderAccessMode ?? "public"} />
            </div>

            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShoppingBag className="h-5 w-5" />
                  Storefront
                </CardTitle>
                <CardDescription>{config?.theme.siteName ?? "WM Supplies"}</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <div className="space-y-3">
                  <div className="rounded-md border border-metal-edge bg-metal-charcoal/35 p-4">
                    <div className="text-sm text-metal-muted">Public URL</div>
                    <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <code className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap rounded bg-black/30 px-2 py-1 text-sm text-metal-warm-white">
                        {publicUrl}
                      </code>
                      <Button asChild variant="outline" size="sm">
                        <a href={publicUrl} target="_blank" rel="noreferrer">
                          <ExternalLink className="mr-2 h-4 w-4" />
                          Open
                        </a>
                      </Button>
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" onClick={() => startNewBlock("hero")}>
                      <Plus className="mr-2 h-4 w-4" />
                      New block
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setActiveTab("theme")}>
                      <Palette className="mr-2 h-4 w-4" />
                      Theme
                    </Button>
                    <Button type="button" variant="outline" onClick={() => setActiveTab("ordering")}>
                      <ShoppingBag className="mr-2 h-4 w-4" />
                      Ordering
                    </Button>
                  </div>
                </div>
                <PublicPreview
                  config={{
                    theme: config?.theme ?? fallbackWebsiteTheme,
                    orderSettings: config?.orderSettings ?? fallbackOrderSettings,
                    blocks: sortedBlocks,
                  }}
                />
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="theme" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <Palette className="h-5 w-5" />
                  Theme
                </CardTitle>
                <CardDescription>Site name, colours, and optional font/CSS settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="website-site-name">Site name</Label>
                    <Input
                      id="website-site-name"
                      value={themeDraft.siteName}
                      onChange={(event) => setThemeDraftField("siteName", event.target.value)}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="website-heading-font">Heading font</Label>
                    <Input
                      id="website-heading-font"
                      value={themeDraft.headingFont ?? ""}
                      onChange={(event) =>
                        setThemeDraftField("headingFont", event.target.value || null)
                      }
                    />
                  </div>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                  <ColorField id="website-primary" label="Primary" value={themeDraft.primaryColor} onChange={(value) => setThemeDraftField("primaryColor", value)} />
                  <ColorField id="website-secondary" label="Secondary" value={themeDraft.secondaryColor} onChange={(value) => setThemeDraftField("secondaryColor", value)} />
                  <ColorField id="website-accent" label="Accent" value={themeDraft.accentColor} onChange={(value) => setThemeDraftField("accentColor", value)} />
                  <ColorField id="website-background" label="Background" value={themeDraft.backgroundColor} onChange={(value) => setThemeDraftField("backgroundColor", value)} />
                  <ColorField id="website-text" label="Text" value={themeDraft.textColor} onChange={(value) => setThemeDraftField("textColor", value)} />
                  <ColorField id="website-border" label="Border" value={themeDraft.borderColor} onChange={(value) => setThemeDraftField("borderColor", value)} />
                  <ColorField id="website-button-bg" label="Button background" value={themeDraft.buttonBackgroundColor} onChange={(value) => setThemeDraftField("buttonBackgroundColor", value)} />
                  <ColorField id="website-button-text" label="Button text" value={themeDraft.buttonTextColor} onChange={(value) => setThemeDraftField("buttonTextColor", value)} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="website-custom-css">Custom CSS</Label>
                  <Textarea
                    id="website-custom-css"
                    value={themeDraft.customCss ?? ""}
                    onChange={(event) =>
                      setThemeDraftField("customCss", event.target.value || null)
                    }
                    rows={5}
                    className="font-mono text-sm"
                  />
                </div>
                <Button type="button" disabled={themeMutation.isPending} onClick={() => themeMutation.mutate()}>
                  <Save className="mr-2 h-4 w-4" />
                  Save theme
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="blocks" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[380px_1fr]">
              <Card className={LM_CARD}>
                <CardHeader>
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-xl">Blocks</CardTitle>
                      <CardDescription>Homepage sections in display order</CardDescription>
                    </div>
                    <Button
                      type="button"
                      size="icon"
                      aria-label="Add a homepage block"
                      onClick={() => startNewBlock()}
                    >
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {sortedBlocks.length === 0 ? (
                    <div className="rounded-md border border-metal-edge bg-metal-charcoal/30 p-4 text-sm text-metal-muted">
                      No content blocks yet.
                    </div>
                  ) : (
                    sortedBlocks.map((block, index) => (
                      <BlockListRow
                        key={block.id}
                        block={block}
                        selected={!isNewBlock && selectedBlockId === block.id}
                        canMoveUp={index > 0}
                        canMoveDown={index < sortedBlocks.length - 1}
                        busy={isBusy}
                        onSelect={() => {
                          setIsNewBlock(false);
                          setSelectedBlockId(block.id);
                        }}
                        onMove={(direction) =>
                          blockActionMutation.mutate({ action: "move", block, direction })
                        }
                        onToggle={(visible) =>
                          blockActionMutation.mutate({ action: "toggle", block, visible })
                        }
                        onDuplicate={() =>
                          blockActionMutation.mutate({ action: "duplicate", block })
                        }
                        onDelete={() => {
                          if (window.confirm("Delete this website block?")) {
                            blockActionMutation.mutate({ action: "delete", block });
                          }
                        }}
                      />
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className={LM_CARD}>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <CardTitle className="text-xl">
                        {isNewBlock ? "New block" : selectedBlock?.title || "Edit block"}
                      </CardTitle>
                      <CardDescription>
                        {isNewBlock ? "Create a homepage section" : selectedBlock?.id}
                      </CardDescription>
                    </div>
                    <StatusBadge enabled={blockDraft.isVisible} />
                  </div>
                </CardHeader>
                <CardContent className="space-y-5">
                  <div className="grid gap-4 md:grid-cols-4">
                    <div className="space-y-2">
                      <Label htmlFor="block-type">Type</Label>
                      <Select
                        value={blockDraft.type}
                        onValueChange={(value) =>
                          setBlockDraftField("type", value as WebsiteBlockType)
                        }
                      >
                        <SelectTrigger id="block-type">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {WEBSITE_BLOCK_TYPE_OPTIONS.map((type) => (
                            <SelectItem key={type} value={type}>{type}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="block-page">Page</Label>
                      <Input
                        id="block-page"
                        value={blockDraft.page}
                        onChange={(event) => setBlockDraftField("page", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="block-sort">Sort</Label>
                      <Input
                        id="block-sort"
                        type="number"
                        value={blockDraft.sortOrder}
                        onChange={(event) => setBlockDraftField("sortOrder", event.target.value)}
                      />
                    </div>
                    <div className="flex items-center justify-between rounded-md border border-metal-edge bg-metal-charcoal/25 px-3 py-2">
                      <Label htmlFor="block-visible">Visible</Label>
                      <Switch
                        id="block-visible"
                        checked={blockDraft.isVisible}
                        onCheckedChange={(checked) => setBlockDraftField("isVisible", checked)}
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="block-title">Title</Label>
                      <Input
                        id="block-title"
                        value={blockDraft.title}
                        onChange={(event) => setBlockDraftField("title", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="block-subtitle">Subtitle</Label>
                      <Input
                        id="block-subtitle"
                        value={blockDraft.subtitle}
                        onChange={(event) => setBlockDraftField("subtitle", event.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="block-body">Body</Label>
                    <Textarea
                      id="block-body"
                      value={blockDraft.body}
                      onChange={(event) => setBlockDraftField("body", event.target.value)}
                      rows={4}
                    />
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="block-cta-label">CTA label</Label>
                      <Input
                        id="block-cta-label"
                        value={blockDraft.ctaLabel}
                        onChange={(event) => setBlockDraftField("ctaLabel", event.target.value)}
                      />
                    </div>
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="block-cta-link">CTA link</Label>
                      <Input
                        id="block-cta-link"
                        value={blockDraft.ctaLink}
                        onChange={(event) => setBlockDraftField("ctaLink", event.target.value)}
                        placeholder="/order"
                      />
                    </div>
                  </div>

                  <div className="grid gap-4 md:grid-cols-3">
                    <div className="space-y-2 md:col-span-2">
                      <Label htmlFor="block-image">Image</Label>
                      <Select
                        value={blockDraft.imageFileId || NO_IMAGE}
                        onValueChange={(value) =>
                          setBlockDraftField("imageFileId", value === NO_IMAGE ? "" : value)
                        }
                      >
                        <SelectTrigger id="block-image">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={NO_IMAGE}>No image</SelectItem>
                          {uploads.map((upload) => (
                            <SelectItem key={upload.id} value={upload.id}>
                              {upload.altText || upload.fileName}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="block-image-fit">Image fit</Label>
                      <Select
                        value={blockDraft.imageFit}
                        onValueChange={(value) =>
                          setBlockDraftField("imageFit", value as WebsiteBlockDraft["imageFit"])
                        }
                      >
                        <SelectTrigger id="block-image-fit">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="cover">cover</SelectItem>
                          <SelectItem value="contain">contain</SelectItem>
                          <SelectItem value="fill">fill</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <Separator />

                  <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <ColorField id="block-bg" label="Background" value={blockDraft.backgroundColor} onChange={(value) => setBlockDraftField("backgroundColor", value)} />
                    <ColorField id="block-text" label="Text" value={blockDraft.textColor} onChange={(value) => setBlockDraftField("textColor", value)} />
                    <ColorField id="block-border" label="Border" value={blockDraft.borderColor} onChange={(value) => setBlockDraftField("borderColor", value)} />
                    <ColorField id="block-button-bg" label="Button background" value={blockDraft.buttonBackgroundColor} onChange={(value) => setBlockDraftField("buttonBackgroundColor", value)} />
                    <ColorField id="block-button-text" label="Button text" value={blockDraft.buttonTextColor} onChange={(value) => setBlockDraftField("buttonTextColor", value)} />
                    <ColorField id="block-overlay" label="Overlay" value={blockDraft.overlayColor} onChange={(value) => setBlockDraftField("overlayColor", value)} />
                  </div>

                  <div className="grid gap-4 md:grid-cols-[160px_1fr]">
                    <div className="space-y-2">
                      <Label htmlFor="block-overlay-opacity">Overlay opacity</Label>
                      <Input
                        id="block-overlay-opacity"
                        type="number"
                        min="0"
                        max="1"
                        step="0.05"
                        value={blockDraft.overlayOpacity}
                        onChange={(event) =>
                          setBlockDraftField("overlayOpacity", event.target.value)
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="block-content-json">Content JSON</Label>
                      <Textarea
                        id="block-content-json"
                        value={blockDraft.contentText}
                        onChange={(event) => setBlockDraftField("contentText", event.target.value)}
                        rows={4}
                        className="font-mono text-sm"
                      />
                    </div>
                  </div>

                  <Button
                    type="button"
                    disabled={blockMutation.isPending}
                    onClick={() => blockMutation.mutate()}
                    data-testid="button-save-website-block"
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save block
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="media" className="space-y-6">
            <div className="grid gap-6 lg:grid-cols-[1fr_420px]">
              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-xl">
                    <ImagePlus className="h-5 w-5" />
                    Media
                  </CardTitle>
                  <CardDescription>Available storefront images</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {uploads.length === 0 ? (
                    <div className="rounded-md border border-metal-edge bg-metal-charcoal/30 p-4 text-sm text-metal-muted">
                      No media files available.
                    </div>
                  ) : (
                    uploads.map((upload) => (
                      <div
                        key={upload.id}
                        className="flex flex-col gap-3 rounded-md border border-metal-edge bg-metal-charcoal/25 p-3 sm:flex-row sm:items-center"
                      >
                        <div className="h-20 w-28 shrink-0 overflow-hidden rounded-md border border-metal-edge bg-black/25">
                          <img
                            src={upload.publicUrl}
                            alt={upload.altText ?? ""}
                            className="h-full w-full object-cover"
                          />
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-semibold text-metal-warm-white">
                            {upload.altText || upload.fileName}
                          </div>
                          <div className="mt-1 truncate text-xs text-metal-muted">
                            {upload.publicUrl}
                          </div>
                          <div className="mt-2 flex flex-wrap gap-2 text-xs text-metal-muted">
                            <Badge variant="outline" className="border-metal-edge text-metal-muted">
                              {upload.mimeType}
                            </Badge>
                            <span>{formatBytes(upload.byteSize)}</span>
                            {upload.width && upload.height ? (
                              <span>{upload.width} x {upload.height}</span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </CardContent>
              </Card>

              <Card className={LM_CARD}>
                <CardHeader>
                  <CardTitle className="text-xl">Add Image URL</CardTitle>
                  <CardDescription>Register an existing hosted JPG, PNG, or WebP</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="media-public-url">Public URL</Label>
                    <Input
                      id="media-public-url"
                      value={mediaDraft.publicUrl}
                      onChange={(event) =>
                        setMediaDraft((draft) => ({ ...draft, publicUrl: event.target.value }))
                      }
                      placeholder="/uploads/website/hero.webp"
                    />
                  </div>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="media-file-name">File name</Label>
                      <Input
                        id="media-file-name"
                        value={mediaDraft.fileName}
                        onChange={(event) =>
                          setMediaDraft((draft) => ({ ...draft, fileName: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="media-mime">MIME type</Label>
                      <Select
                        value={mediaDraft.mimeType}
                        onValueChange={(value) =>
                          setMediaDraft((draft) => ({
                            ...draft,
                            mimeType: value as WebsiteMediaDraft["mimeType"],
                          }))
                        }
                      >
                        <SelectTrigger id="media-mime">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="image/webp">image/webp</SelectItem>
                          <SelectItem value="image/png">image/png</SelectItem>
                          <SelectItem value="image/jpeg">image/jpeg</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="space-y-2">
                      <Label htmlFor="media-bytes">Bytes</Label>
                      <Input
                        id="media-bytes"
                        type="number"
                        value={mediaDraft.byteSize}
                        onChange={(event) =>
                          setMediaDraft((draft) => ({ ...draft, byteSize: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="media-width">Width</Label>
                      <Input
                        id="media-width"
                        type="number"
                        value={mediaDraft.width}
                        onChange={(event) =>
                          setMediaDraft((draft) => ({ ...draft, width: event.target.value }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="media-height">Height</Label>
                      <Input
                        id="media-height"
                        type="number"
                        value={mediaDraft.height}
                        onChange={(event) =>
                          setMediaDraft((draft) => ({ ...draft, height: event.target.value }))
                        }
                      />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="media-alt">Alt text</Label>
                    <Input
                      id="media-alt"
                      value={mediaDraft.altText}
                      onChange={(event) =>
                        setMediaDraft((draft) => ({ ...draft, altText: event.target.value }))
                      }
                    />
                  </div>
                  <Button
                    type="button"
                    disabled={mediaMutation.isPending}
                    onClick={() => mediaMutation.mutate()}
                  >
                    <Save className="mr-2 h-4 w-4" />
                    Save media
                  </Button>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="ordering" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  <ShoppingBag className="h-5 w-5" />
                  Ordering
                </CardTitle>
                <CardDescription>Public order access and default fulfilment settings</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 md:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="order-access-mode">Access mode</Label>
                    <Select
                      value={orderDraft.orderAccessMode}
                      onValueChange={(value) =>
                        setOrderDraftField(
                          "orderAccessMode",
                          value as WebsiteOrderSettingsDraft["orderAccessMode"],
                        )
                      }
                    >
                      <SelectTrigger id="order-access-mode">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEBSITE_ORDER_ACCESS_MODE_OPTIONS.map((mode) => (
                          <SelectItem key={mode} value={mode}>{mode}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="order-default-status">Default status</Label>
                    <Select
                      value={orderDraft.defaultOrderStatus}
                      onValueChange={(value) =>
                        setOrderDraftField("defaultOrderStatus", value)
                      }
                    >
                      <SelectTrigger id="order-default-status">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {WEBSITE_ORDER_STATUS_OPTIONS.map((status) => (
                          <SelectItem key={status} value={status}>{status}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="order-minimum">Minimum order value</Label>
                    <Input
                      id="order-minimum"
                      type="number"
                      min="0"
                      step="0.01"
                      value={orderDraft.minOrderValue}
                      onChange={(event) => setOrderDraftField("minOrderValue", event.target.value)}
                    />
                  </div>
                </div>
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="order-location">Default location ID</Label>
                    <Input
                      id="order-location"
                      value={orderDraft.defaultLocationId ?? ""}
                      onChange={(event) =>
                        setOrderDraftField("defaultLocationId", event.target.value || null)
                      }
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="order-email">Notification email</Label>
                    <Input
                      id="order-email"
                      type="email"
                      value={orderDraft.notificationEmail ?? ""}
                      onChange={(event) =>
                        setOrderDraftField("notificationEmail", event.target.value || null)
                      }
                    />
                  </div>
                </div>
                <div className="flex items-center justify-between rounded-md border border-metal-edge bg-metal-charcoal/25 px-4 py-3">
                  <div>
                    <Label htmlFor="order-out-of-stock">Out-of-stock orders</Label>
                    <p className="mt-1 text-sm text-metal-muted">Accept order requests when stock is short</p>
                  </div>
                  <Switch
                    id="order-out-of-stock"
                    checked={orderDraft.allowOutOfStockOrders}
                    onCheckedChange={(checked) =>
                      setOrderDraftField("allowOutOfStockOrders", checked)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="order-intro">Order intro</Label>
                  <Textarea
                    id="order-intro"
                    value={orderDraft.orderIntroText ?? ""}
                    onChange={(event) =>
                      setOrderDraftField("orderIntroText", event.target.value || null)
                    }
                    rows={3}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="order-success">Success message</Label>
                  <Textarea
                    id="order-success"
                    value={orderDraft.successMessage ?? ""}
                    onChange={(event) =>
                      setOrderDraftField("successMessage", event.target.value || null)
                    }
                    rows={3}
                  />
                </div>
                <Button
                  type="button"
                  disabled={orderMutation.isPending}
                  onClick={() => orderMutation.mutate()}
                >
                  <Save className="mr-2 h-4 w-4" />
                  Save ordering
                </Button>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="preview" className="space-y-6">
            <Card className={LM_CARD}>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-xl">
                  {visibleBlocks.length > 0 ? <Eye className="h-5 w-5" /> : <EyeOff className="h-5 w-5" />}
                  Preview
                </CardTitle>
                <CardDescription>Current saved homepage blocks with hidden blocks marked</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <PublicPreview
                  config={{
                    theme: config?.theme ?? fallbackWebsiteTheme,
                    orderSettings: config?.orderSettings ?? fallbackOrderSettings,
                    blocks: sortedBlocks,
                  }}
                />
                <Button asChild variant="outline">
                  <a href={publicUrl} target="_blank" rel="noreferrer">
                    <ExternalLink className="mr-2 h-4 w-4" />
                    Open public website
                  </a>
                </Button>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
