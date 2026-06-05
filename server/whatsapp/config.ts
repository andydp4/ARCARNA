/**
 * WhatsApp Business (Cloud API) configuration.
 *
 * All secrets are read from the environment and stay server-side (Principle 7).
 * The integration is disabled by default; outbound sends and webhook processing
 * are no-ops until WHATSAPP_ENABLED=true and the required secrets are present.
 */

export interface WhatsappConfig {
  /** Master switch. When false, the channel is dormant. */
  enabled: boolean;
  /** Token echoed back during Meta's GET webhook verification handshake. */
  verifyToken: string;
  /** Permanent system-user access token for the Graph/Messages API. */
  accessToken: string;
  /** Phone number ID (from WhatsApp > API Setup) used for outbound sends. */
  phoneNumberId: string;
  /** WhatsApp Business Account (WABA) ID, used for template sync. */
  businessAccountId: string;
  /** Meta app secret, used to verify the X-Hub-Signature-256 webhook HMAC. */
  appSecret: string;
  /** Default country dialing code for normalising local numbers (UK = 44). */
  defaultCountryCode: string;
  /** Graph API version segment, e.g. "v21.0". */
  graphApiVersion: string;
}

function envBool(value: string | undefined): boolean {
  if (!value) return false;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

export function getWhatsappConfig(): WhatsappConfig {
  return {
    enabled: envBool(process.env.WHATSAPP_ENABLED),
    verifyToken: process.env.WHATSAPP_VERIFY_TOKEN?.trim() ?? "",
    accessToken: process.env.WHATSAPP_ACCESS_TOKEN?.trim() ?? "",
    phoneNumberId: process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() ?? "",
    businessAccountId: process.env.WHATSAPP_BUSINESS_ACCOUNT_ID?.trim() ?? "",
    appSecret: process.env.WHATSAPP_APP_SECRET?.trim() ?? "",
    defaultCountryCode: process.env.WHATSAPP_DEFAULT_COUNTRY_CODE?.trim() || "44",
    graphApiVersion: process.env.WHATSAPP_GRAPH_API_VERSION?.trim() || "v21.0",
  };
}

/** True when the channel is switched on. */
export function isWhatsappEnabled(): boolean {
  return getWhatsappConfig().enabled;
}

/** True when outbound sends are possible (enabled + credentials present). */
export function canSendWhatsapp(cfg: WhatsappConfig = getWhatsappConfig()): boolean {
  return cfg.enabled && !!cfg.accessToken && !!cfg.phoneNumberId;
}

/** True when inbound webhook signatures can be verified. */
export function canVerifyWhatsappSignature(cfg: WhatsappConfig = getWhatsappConfig()): boolean {
  return !!cfg.appSecret;
}
