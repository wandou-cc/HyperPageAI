import type {
  ElementKind,
  SelectionSnapshot,
  ViewportRect,
} from "./messages";
import { containsSensitiveField, getVisibleText, isSensitiveElement, isVisibleContent } from "./dom-content";

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
  if (isSensitiveElement(element) || !isVisibleContent(element)) return "";
  if (element instanceof HTMLInputElement) {
    return element.type === "hidden" ? "" : element.value.trim();
  }
  if (element instanceof HTMLTextAreaElement) return element.value.trim();
  return getVisibleText(element);
}

// Resolves the accessible label using the element semantics Chrome users encounter.
export function getAccessibleName(element: Element): string {
  if (isSensitiveElement(element)) return "";
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel.trim();
  if (element instanceof HTMLImageElement && element.alt) return element.alt.trim();
  const title = element.getAttribute("title");
  return title ? title.trim() : "";
}

export function isTextEditableElement(element: Element): element is HTMLElement {
  if (!isVisibleContent(element) || containsSensitiveField(element) || element.matches(":disabled, [readonly], [aria-readonly='true']")) return false;
  if (element instanceof HTMLInputElement) return ["text", "search", "url", "tel", "email"].includes(element.type);
  return element instanceof HTMLTextAreaElement || (element instanceof HTMLElement && (element.isContentEditable || element.matches('[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')));
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
    editable: isTextEditableElement(element),
    rect,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
  };
}
