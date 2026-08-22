import { mkdir, rm, writeFile } from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import {
  WEBSITE_ALLOWED_IMAGE_MIME_TYPES,
  WEBSITE_MAX_IMAGE_BYTES,
  type WebsiteUploadMetadata,
} from "@shared/website";

export interface WebsiteImageUploadInput {
  orgId: string;
  fileName: string;
  mimeType: string;
  buffer: Buffer;
  altText?: string | null;
}

export interface StoredWebsiteFile {
  provider: "local" | "r2";
  storageKey: string;
  publicUrl: string;
  fileName: string;
  originalFileName: string;
  mimeType: (typeof WEBSITE_ALLOWED_IMAGE_MIME_TYPES)[number];
  byteSize: number;
  altText?: string | null;
}

export interface WebsiteFileStorageProvider {
  save(input: WebsiteImageUploadInput): Promise<StoredWebsiteFile>;
  delete(storageKey: string): Promise<void>;
}

const EXTENSION_BY_MIME: Record<(typeof WEBSITE_ALLOWED_IMAGE_MIME_TYPES)[number], string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

function isAllowedImageMime(
  mimeType: string,
): mimeType is (typeof WEBSITE_ALLOWED_IMAGE_MIME_TYPES)[number] {
  return (WEBSITE_ALLOWED_IMAGE_MIME_TYPES as readonly string[]).includes(mimeType);
}

function normalizedMime(mimeType: string) {
  return mimeType.split(";")[0]?.trim().toLowerCase() ?? "";
}

export function sanitizeWebsiteFileName(fileName: string): string {
  const base = path.basename(fileName).trim();
  if (!base || base === "." || base === "..") {
    throw new Error("File name is required");
  }
  if (base !== fileName || fileName.includes("/") || fileName.includes("\\")) {
    throw new Error("File name cannot include path separators");
  }

  const sanitized = base
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9._-]/g, "")
    .replace(/-+/g, "-")
    .replace(/^\.+/, "");

  if (!sanitized) throw new Error("File name is invalid");
  return sanitized.slice(0, 120);
}

function detectImageMime(buffer: Buffer): (typeof WEBSITE_ALLOWED_IMAGE_MIME_TYPES)[number] | null {
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) {
    return "image/jpeg";
  }

  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return "image/png";
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString("ascii") === "RIFF" &&
    buffer.subarray(8, 12).toString("ascii") === "WEBP"
  ) {
    return "image/webp";
  }

  return null;
}

export function validateWebsiteImageUpload(input: WebsiteImageUploadInput) {
  const mimeType = normalizedMime(input.mimeType);
  if (!isAllowedImageMime(mimeType)) {
    throw new Error("Unsupported image type. Use JPG, PNG, or WebP.");
  }
  if (input.buffer.length === 0) throw new Error("File is empty");
  if (input.buffer.length > WEBSITE_MAX_IMAGE_BYTES) {
    throw new Error(`File exceeds ${WEBSITE_MAX_IMAGE_BYTES / (1024 * 1024)}MB limit`);
  }

  const detected = detectImageMime(input.buffer);
  if (!detected) throw new Error("File content is not a supported image");
  if (detected !== mimeType) {
    throw new Error("File extension or MIME type does not match the image content");
  }

  const safeFileName = sanitizeWebsiteFileName(input.fileName);
  const expectedExtension = EXTENSION_BY_MIME[detected];
  const lower = safeFileName.toLowerCase();
  if (detected === "image/jpeg") {
    if (!lower.endsWith(".jpg") && !lower.endsWith(".jpeg")) {
      throw new Error("JPG uploads must use a .jpg or .jpeg file name");
    }
  } else if (!lower.endsWith(expectedExtension)) {
    throw new Error(`${expectedExtension} uploads must use a matching file name`);
  }

  return {
    orgId: input.orgId,
    fileName: safeFileName,
    originalFileName: input.fileName,
    mimeType: detected,
    byteSize: input.buffer.length,
    altText: input.altText ?? null,
  };
}

export function websiteUploadStorageKey(orgId: string, uploadId: string, fileName: string): string {
  const safeFileName = sanitizeWebsiteFileName(fileName);
  return `orgs/${orgId}/uploads/website/${uploadId}/${safeFileName}`;
}

function resolveInside(root: string, storageKey: string): string {
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, storageKey);
  if (target !== rootPath && !target.startsWith(`${rootPath}${path.sep}`)) {
    throw new Error("Storage key escapes upload directory");
  }
  return target;
}

export class LocalWebsiteFileStorageProvider implements WebsiteFileStorageProvider {
  constructor(
    private readonly rootDir = path.resolve(process.cwd(), "uploads", "website"),
    private readonly publicBaseUrl = "/uploads/website",
  ) {}

  async save(input: WebsiteImageUploadInput): Promise<StoredWebsiteFile> {
    const validated = validateWebsiteImageUpload(input);
    const uploadId = randomUUID();
    const storageKey = websiteUploadStorageKey(input.orgId, uploadId, validated.fileName);
    const destination = resolveInside(this.rootDir, storageKey);

    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, input.buffer, { flag: "wx" });

    return {
      provider: "local",
      storageKey,
      publicUrl: `${this.publicBaseUrl}/${storageKey}`,
      fileName: validated.fileName,
      originalFileName: validated.originalFileName,
      mimeType: validated.mimeType,
      byteSize: validated.byteSize,
      altText: validated.altText,
    };
  }

  async delete(storageKey: string): Promise<void> {
    await rm(resolveInside(this.rootDir, storageKey), { force: true });
  }
}

export function storedFileToMetadata(file: StoredWebsiteFile): WebsiteUploadMetadata {
  return {
    provider: file.provider,
    storageKey: file.storageKey,
    publicUrl: file.publicUrl,
    fileName: file.fileName,
    originalFileName: file.originalFileName,
    mimeType: file.mimeType,
    byteSize: file.byteSize,
    altText: file.altText,
  };
}
