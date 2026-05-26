import { IMPORT_MAX_UPLOAD_BYTES } from "@shared/importLimits";

export function assertImportFileSize(file: File): void {
  if (file.size > IMPORT_MAX_UPLOAD_BYTES) {
    const mb = IMPORT_MAX_UPLOAD_BYTES / (1024 * 1024);
    throw new Error(`File is too large (max ${mb} MB). Export fewer contacts or split the file.`);
  }
}

/** vCard uploads as UTF-8 text (smaller than base64); spreadsheets use base64. */
export async function buildCustomerImportPreviewBody(
  file: File,
  extra: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  assertImportFileSize(file);
  if (/\.vcf$/i.test(file.name)) {
    return { ...extra, fileName: file.name, contentText: await file.text() };
  }
  return { ...extra, fileName: file.name, contentBase64: await fileToBase64(file) };
}

export function fileToBase64(file: File): Promise<string> {
  assertImportFileSize(file);
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.includes(",") ? result.split(",")[1] : result;
      resolve(base64);
    };
    reader.onerror = () => reject(new Error("Failed to read file"));
    reader.readAsDataURL(file);
  });
}

export function downloadBlob(content: string, filename: string, mime = "text/csv") {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
