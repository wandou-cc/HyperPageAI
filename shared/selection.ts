import type {
  ElementKind,
  SelectionSnapshot,
  ViewportRect,
} from "./messages";

// Classifies a selected DOM element for action availability and payload handling.
export function getElementKind(element: Element): ElementKind {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLTextAreaElement ||
    (element instanceof HTMLElement && element.isContentEditable)
  ) {
    return "editable";
  }
  if (element instanceof HTMLImageElement) return "image";
  if (element instanceof HTMLVideoElement) return "video";
  if (element instanceof HTMLCanvasElement) return "canvas";
  if (getElementText(element)) return "text";
  return "element";
}

// Reads only content the user can meaningfully act on and never exposes password values.
export function getElementText(element: Element): string {
  if (element instanceof HTMLInputElement) {
    return element.type === "password" ? "" : element.value.trim();
  }
  if (element instanceof HTMLTextAreaElement) return element.value.trim();
  if (element instanceof HTMLElement) return element.innerText.trim();
  return element.textContent?.trim() ?? "";
}

// Resolves the accessible label using the element semantics Chrome users encounter.
export function getAccessibleName(element: Element): string {
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();
  if (element instanceof HTMLImageElement && element.alt) return element.alt.trim();
  const title = element.getAttribute("title");
  return title ? title.trim() : "";
}

// Captures the current element state in viewport coordinates for extension messaging.
export function createSelectionSnapshot(
  element: Element,
): SelectionSnapshot {
  const bounds = element.getBoundingClientRect();
  const rect: ViewportRect = {
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
  };

  return {
    kind: getElementKind(element),
    tagName: element.tagName.toLowerCase(),
    text: getElementText(element),
    accessibleName: getAccessibleName(element),
    role: element.getAttribute("role")?.trim() ?? "",
    editable: Boolean(
      (element instanceof HTMLInputElement && element.type !== "password") ||
        element instanceof HTMLTextAreaElement ||
        (element instanceof HTMLElement && element.isContentEditable),
    ),
    rect,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}
