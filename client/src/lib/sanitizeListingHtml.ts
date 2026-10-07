import DOMPurify from "dompurify";

/** Preview formatting only. Never treat user/AI HTML as instructions or trusted DOM. */
export function sanitizeListingHtml(value: string | null | undefined): string {
  if (typeof window === "undefined" || !value) return "";
  return DOMPurify.sanitize(value, {
    ALLOWED_TAGS: ["p", "br", "div", "span", "b", "strong", "i", "em", "u", "ul", "ol", "li", "h3", "h4"],
    ALLOWED_ATTR: [],
  });
}
