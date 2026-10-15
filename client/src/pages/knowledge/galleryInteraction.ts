import type { KeyboardEvent } from "react";

/** Do not handle a nested fit-toggle, delete or retry button's key event. */
export function activateGalleryItem(event: Pick<KeyboardEvent, "target" | "currentTarget" | "key" | "preventDefault">, activate: () => void) {
  if (event.target === event.currentTarget && (event.key === "Enter" || event.key === " ")) {
    event.preventDefault();
    activate();
  }
}

export function currentGalleryIndex(items: ReadonlyArray<{ id: number }>, id: number | null): number {
  if (!items.length) return -1;
  const index = items.findIndex(item => item.id === id);
  return index < 0 ? 0 : index;
}
