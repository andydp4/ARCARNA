/** Max raw upload size for import files (.vcf, .csv, .xlsx). */
export const IMPORT_MAX_UPLOAD_BYTES = 20 * 1024 * 1024;

/** Express JSON/urlencoded body limit (base64 expands ~33%; large vCard exports need headroom). */
export const IMPORT_JSON_BODY_LIMIT = "25mb";
