/** Max .vcf/.csv size read in the browser (Apple exports with photos can be 15MB+). */
export const IMPORT_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** Express JSON/urlencoded body limit (base64 expands ~33%; large vCard exports need headroom). */
export const IMPORT_JSON_BODY_LIMIT = "25mb";

/** Max contacts per import batch (client parse + preview-rows API). */
export const IMPORT_MAX_ROWS = 15_000;
