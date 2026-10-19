/** Local transport/storage failures use structured codes. Messages are display
 * diagnostics only and never determine authorization or recovery state. */
export type SupplementClientErrorCode =
  | "SUPPLEMENT_ABORTED"
  | "SUPPLEMENT_FILE_LIMIT"
  | "SUPPLEMENT_FILE_TYPE"
  | "SUPPLEMENT_FILE_READ"
  | "SUPPLEMENT_DOWNLOAD_INVALID"
  | "SUPPLEMENT_RESPONSE_INVALID"
  | "SUPPLEMENT_STORAGE_UNAVAILABLE"
  | "SUPPLEMENT_STORAGE_UNVERIFIED"
  | "SUPPLEMENT_LOCK_UNAVAILABLE"
  | "SUPPLEMENT_PENDING_INVALID"
  | "SUPPLEMENT_PENDING_EXISTS";

export class SupplementClientError extends Error {
  constructor(readonly code: SupplementClientErrorCode) {
    super(code);
    this.name = "SupplementClientError";
  }
}
