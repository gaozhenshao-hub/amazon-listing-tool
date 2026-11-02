export type ImageBrowseViewMode = "asin" | "waterfall" | "grid";

/** Image-level views must refresh their own query when activated. */
export function shouldRefreshImageBrowse(viewMode: ImageBrowseViewMode): boolean {
  return viewMode !== "asin";
}
