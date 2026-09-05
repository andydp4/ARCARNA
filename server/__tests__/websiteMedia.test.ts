import { mkdtemp, readFile, rm, stat } from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  LocalWebsiteFileStorageProvider,
  sanitizeWebsiteFileName,
  storedFileToMetadata,
  validateWebsiteImageUpload,
  websiteUploadStorageKey,
} from "../services/websiteMedia";

const PNG_BYTES = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
]);
const JPG_BYTES = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
const WEBP_BYTES = Buffer.from("RIFFxxxxWEBPVP8 ", "ascii");

let tmpRoot: string | null = null;

afterEach(async () => {
  if (tmpRoot) await rm(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("validateWebsiteImageUpload", () => {
  it("accepts JPG, PNG, and WebP image signatures", () => {
    expect(
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "display.jpg",
        mimeType: "image/jpeg",
        buffer: JPG_BYTES,
      }).mimeType,
    ).toBe("image/jpeg");

    expect(
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "display.png",
        mimeType: "image/png",
        buffer: PNG_BYTES,
      }).mimeType,
    ).toBe("image/png");

    expect(
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "display.webp",
        mimeType: "image/webp",
        buffer: WEBP_BYTES,
      }).mimeType,
    ).toBe("image/webp");
  });

  it("rejects fake files and MIME mismatches", () => {
    expect(() =>
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "fake.png",
        mimeType: "image/png",
        buffer: Buffer.from("not an image"),
      }),
    ).toThrow(/not a supported image/i);

    expect(() =>
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "wrong.png",
        mimeType: "image/png",
        buffer: JPG_BYTES,
      }),
    ).toThrow(/does not match/i);
  });

  it("rejects unsupported MIME types, oversized files, and path traversal names", () => {
    expect(() =>
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "file.svg",
        mimeType: "image/svg+xml",
        buffer: Buffer.from("<svg />"),
      }),
    ).toThrow(/unsupported image type/i);

    expect(() =>
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "large.png",
        mimeType: "image/png",
        buffer: Buffer.concat([PNG_BYTES, Buffer.alloc(11 * 1024 * 1024)]),
      }),
    ).toThrow(/exceeds/i);

    expect(() =>
      validateWebsiteImageUpload({
        orgId: "org-1",
        fileName: "../escape.png",
        mimeType: "image/png",
        buffer: PNG_BYTES,
      }),
    ).toThrow(/path separators/i);
  });
});

describe("website local storage provider", () => {
  it("sanitizes file names and creates org-scoped storage keys", () => {
    expect(sanitizeWebsiteFileName("Promo Board 1.webp")).toBe("Promo-Board-1.webp");
    expect(websiteUploadStorageKey("org-1", "upload-1", "Promo Board 1.webp")).toBe(
      "orgs/org-1/uploads/website/upload-1/Promo-Board-1.webp",
    );
  });

  it("saves and deletes a validated local image", async () => {
    tmpRoot = await mkdtemp(path.join(os.tmpdir(), "wm-website-media-"));
    const provider = new LocalWebsiteFileStorageProvider(tmpRoot, "/media");

    const stored = await provider.save({
      orgId: "org-1",
      fileName: "Promo Board.webp",
      mimeType: "image/webp",
      buffer: WEBP_BYTES,
      altText: "Promo board",
    });

    expect(stored.provider).toBe("local");
    expect(stored.publicUrl).toMatch(/^\/media\/orgs\/org-1\/uploads\/website\//);
    expect(stored.storageKey).toContain("/Promo-Board.webp");
    expect(await readFile(path.join(tmpRoot, stored.storageKey))).toEqual(WEBP_BYTES);

    const metadata = storedFileToMetadata(stored);
    expect(metadata).toMatchObject({
      provider: "local",
      publicUrl: stored.publicUrl,
      fileName: "Promo-Board.webp",
      mimeType: "image/webp",
      altText: "Promo board",
    });

    await provider.delete(stored.storageKey);
    await expect(stat(path.join(tmpRoot, stored.storageKey))).rejects.toThrow();
  });
});
