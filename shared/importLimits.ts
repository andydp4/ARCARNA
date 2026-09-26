/** Max .vcf/.csv size read in the browser (Apple exports with photos can be 15MB+). */
export const IMPORT_MAX_UPLOAD_BYTES = 32 * 1024 * 1024;

/** JSON body limit for every route that is not an import or bulk route (v1.2.1 SEC-BODY-PREAUTH). */
export const DEFAULT_JSON_BODY_LIMIT = "2mb";

/** Express JSON body limit for the import and bulk routes (base64 expands ~33%; large vCard exports need headroom). */
export const IMPORT_JSON_BODY_LIMIT = "25mb";

/** Max contacts per import batch (client parse + preview-rows API). */
export const IMPORT_MAX_ROWS = 15_000;
