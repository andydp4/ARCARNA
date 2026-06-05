/**
 * Outbound WhatsApp Cloud API client (Messages + Templates).
 *
 * The access token never leaves the server (Principle 7). All calls have a
 * timeout and structured error handling so route handlers can surface failures
 * without leaking secrets.
 */
import { getWhatsappConfig, canSendWhatsapp, type WhatsappConfig } from "./config";

export interface SendResult {
  ok: boolean;
  /** Meta message id (wamid...) when the send succeeded. */
  messageId?: string;
  error?: string;
  status?: number;
}

const DEFAULT_TIMEOUT_MS = 10_000;

function graphUrl(cfg: WhatsappConfig, path: string): string {
  return `https://graph.facebook.com/${cfg.graphApiVersion}/${path}`;
}

async function postJson(
  url: string,
  token: string,
  body: unknown,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    let json: Record<string, unknown> = {};
    try {
      json = (await res.json()) as Record<string, unknown>;
    } catch {
      json = {};
    }
    return { status: res.status, json };
  } finally {
    clearTimeout(timer);
  }
}

function extractMessageId(json: Record<string, unknown>): string | undefined {
  const messages = json.messages;
  if (Array.isArray(messages) && messages[0] && typeof messages[0] === "object") {
    const id = (messages[0] as Record<string, unknown>).id;
    if (typeof id === "string") return id;
  }
  return undefined;
}

function extractError(json: Record<string, unknown>): string | undefined {
  const err = json.error;
  if (err && typeof err === "object") {
    const message = (err as Record<string, unknown>).message;
    if (typeof message === "string") return message;
  }
  return undefined;
}

/** Send a free-form text message (only valid inside the 24h service window). */
export async function sendTextMessage(
  toWaId: string,
  text: string,
  cfg: WhatsappConfig = getWhatsappConfig(),
): Promise<SendResult> {
  if (!canSendWhatsapp(cfg)) {
    return { ok: false, error: "WhatsApp is not enabled or is missing credentials" };
  }
  if (!toWaId || !text) {
    return { ok: false, error: "Recipient and message text are required" };
  }
  try {
    const { status, json } = await postJson(
      graphUrl(cfg, `${cfg.phoneNumberId}/messages`),
      cfg.accessToken,
      {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: toWaId,
        type: "text",
        text: { preview_url: false, body: text },
      },
    );
    if (status >= 200 && status < 300) {
      return { ok: true, messageId: extractMessageId(json), status };
    }
    return { ok: false, status, error: extractError(json) ?? `HTTP ${status}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: aborted ? "WhatsApp API request timed out" : "WhatsApp API request failed" };
  }
}

export interface TemplateComponentParam {
  type: "text";
  text: string;
}

/** Send an approved template message (allowed outside the service window). */
export async function sendTemplateMessage(
  toWaId: string,
  templateName: string,
  languageCode: string,
  bodyParams: string[] = [],
  cfg: WhatsappConfig = getWhatsappConfig(),
): Promise<SendResult> {
  if (!canSendWhatsapp(cfg)) {
    return { ok: false, error: "WhatsApp is not enabled or is missing credentials" };
  }
  if (!toWaId || !templateName) {
    return { ok: false, error: "Recipient and template name are required" };
  }
  const components =
    bodyParams.length > 0
      ? [
          {
            type: "body",
            parameters: bodyParams.map<TemplateComponentParam>((t) => ({ type: "text", text: t })),
          },
        ]
      : [];
  try {
    const { status, json } = await postJson(
      graphUrl(cfg, `${cfg.phoneNumberId}/messages`),
      cfg.accessToken,
      {
        messaging_product: "whatsapp",
        to: toWaId,
        type: "template",
        template: {
          name: templateName,
          language: { code: languageCode || "en_GB" },
          components,
        },
      },
    );
    if (status >= 200 && status < 300) {
      return { ok: true, messageId: extractMessageId(json), status };
    }
    return { ok: false, status, error: extractError(json) ?? `HTTP ${status}` };
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, error: aborted ? "WhatsApp API request timed out" : "WhatsApp API request failed" };
  }
}

export interface FetchedTemplate {
  name: string;
  category: string;
  language: string;
  status: string;
  body: string;
  variables: string[];
}

/** List message templates from the WhatsApp Business Account (for sync). */
export async function fetchTemplates(
  cfg: WhatsappConfig = getWhatsappConfig(),
): Promise<{ ok: boolean; templates: FetchedTemplate[]; error?: string }> {
  if (!cfg.accessToken || !cfg.businessAccountId) {
    return { ok: false, templates: [], error: "Missing access token or business account ID" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const url = graphUrl(cfg, `${cfg.businessAccountId}/message_templates?limit=100`);
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.accessToken}` },
      signal: controller.signal,
    });
    const json = (await res.json()) as Record<string, unknown>;
    if (res.status < 200 || res.status >= 300) {
      return { ok: false, templates: [], error: extractError(json) ?? `HTTP ${res.status}` };
    }
    return { ok: true, templates: mapTemplates(json) };
  } catch {
    return { ok: false, templates: [], error: "Template fetch failed" };
  } finally {
    clearTimeout(timer);
  }
}

/** Map the Graph API template list response into our flat shape. */
export function mapTemplates(json: Record<string, unknown>): FetchedTemplate[] {
  const data = Array.isArray(json.data) ? json.data : [];
  const out: FetchedTemplate[] = [];
  for (const raw of data) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw as Record<string, unknown>;
    const components = Array.isArray(t.components) ? t.components : [];
    let body = "";
    for (const compRaw of components) {
      const comp = compRaw as Record<string, unknown>;
      if (comp?.type === "BODY" && typeof comp.text === "string") body = comp.text;
    }
    const variables = (body.match(/\{\{\d+\}\}/g) ?? []).map((v) => v);
    out.push({
      name: typeof t.name === "string" ? t.name : "",
      category: typeof t.category === "string" ? t.category : "",
      language: typeof t.language === "string" ? t.language : "",
      status: typeof t.status === "string" ? t.status : "",
      body,
      variables,
    });
  }
  return out;
}
