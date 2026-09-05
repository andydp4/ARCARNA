export type OrderChannel = "pos" | "web" | "api" | "whatsapp" | "phone" | string;

const ORDER_CHANNEL_LABELS: Record<string, string> = {
  pos: "POS",
  web: "Website",
  api: "API",
  whatsapp: "WhatsApp",
  phone: "Phone",
};

export function normalizeOrderChannel(channel: string | null | undefined): string {
  const value = channel?.trim().toLowerCase();
  return value || "pos";
}

export function formatOrderChannel(channel: string | null | undefined): string {
  const normalized = normalizeOrderChannel(channel);
  return ORDER_CHANNEL_LABELS[normalized] ?? normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export function isWebsiteOrder(channel: string | null | undefined): boolean {
  return normalizeOrderChannel(channel) === "web";
}
