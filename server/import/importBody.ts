import { IMPORT_MAX_UPLOAD_BYTES } from "@shared/importLimits";

export function readVcardTextFromBody(body: {
  contentText?: string;
  contentBase64?: string;
}): string {
  if (typeof body.contentText === "string" && body.contentText.length > 0) {
    if (Buffer.byteLength(body.contentText, "utf8") > IMPORT_MAX_UPLOAD_BYTES) {
      throw new Error(`File exceeds ${IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
    return body.contentText;
  }
  if (body.contentBase64) {
    const buf = Buffer.from(body.contentBase64, "base64");
    if (buf.length > IMPORT_MAX_UPLOAD_BYTES) {
      throw new Error(`File exceeds ${IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
    }
    return buf.toString("utf-8");
  }
  throw new Error("contentText or contentBase64 is required for vCard import");
}

export function readBase64FromBody(body: { contentBase64?: string }, label = "contentBase64"): string {
  if (!body.contentBase64) {
    throw new Error(`${label} is required`);
  }
  const buf = Buffer.from(body.contentBase64, "base64");
  if (buf.length > IMPORT_MAX_UPLOAD_BYTES) {
    throw new Error(`File exceeds ${IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024)}MB limit`);
  }
  return body.contentBase64;
}
