import type { ViewportRect } from "../shared/messages";
import { isSensitiveField, isVisibleContent } from "../shared/dom-content";

export function checkCaptureArea(rect: ViewportRect, viewport: { width: number; height: number }): void {
  if (!rect || !viewport || ![rect.x, rect.y, rect.width, rect.height, viewport.width, viewport.height].every(Number.isFinite) || rect.width <= 0 || rect.height <= 0)
    throw new Error("imageCropInvalid");
  if (window.innerWidth !== viewport.width || window.innerHeight !== viewport.height) throw new Error("requestContextChanged");
  const area = { left: Math.max(0, rect.x), top: Math.max(0, rect.y), right: Math.min(viewport.width, rect.x + rect.width), bottom: Math.min(viewport.height, rect.y + rect.height) };
  if (area.right <= area.left || area.bottom <= area.top) throw new Error("selectionOutsideViewport");
  for (const element of document.querySelectorAll("input, [autocomplete], iframe, object, embed")) {
    if (!isSensitiveField(element) && !element.matches("iframe, object, embed")) continue;
    // Embedded content is opaque to the page reader, so its entire visible area is protected.
    if (!element.matches("iframe, object, embed") && !isVisibleContent(element)) continue;
    const bounds = element.getBoundingClientRect();
    if (bounds.width > 0 && bounds.height > 0 && bounds.left < area.right && bounds.right > area.left && bounds.top < area.bottom && bounds.bottom > area.top)
      throw new Error("captureAreaProtected");
  }
}
