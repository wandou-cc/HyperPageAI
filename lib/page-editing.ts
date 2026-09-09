import type { EditablePreview } from "../shared/messages";
import {
  containsSensitiveField,
  isVisibleContent,
} from "../shared/dom-content";
import { isTextEditableElement } from "../shared/selection";

type Caret = { container: Node; offset: number };
type PreparedEdit = {
  preview: EditablePreview;
  element: HTMLElement;
  text: string;
  original: string;
  caret: number | Caret | null;
};
type EditChange = {
  element: HTMLElement;
  expected: string;
  kind: "value" | "html";
  undo: () => void;
};

export function setEditableValue(
  element: HTMLInputElement | HTMLTextAreaElement,
  value: string,
): void {
  const prototype =
    element instanceof HTMLInputElement
      ? HTMLInputElement.prototype
      : HTMLTextAreaElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("editableSetterUnavailable");
  setter.call(element, value);
  element.dispatchEvent(
    new InputEvent("input", { bubbles: true, data: value }),
  );
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

function requireEditable(element: Element | null): HTMLElement {
  if (!element?.isConnected) throw new Error("editableUnavailable");
  if (containsSensitiveField(element)) throw new Error("sensitiveFieldBlocked");
  if (!isTextEditableElement(element)) throw new Error("editableRequired");
  if (
    !(
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement
    ) &&
    Array.from(element.querySelectorAll("*")).some(
      (child) =>
        !isVisibleContent(child) ||
        child.matches(
          'input, textarea, select, button, [contenteditable="false"]',
        ),
    )
  )
    throw new Error("editableContentUnsupported");
  return element;
}

export class PageEditing {
  private prepared: PreparedEdit | null = null;
  private caret: Caret | null = null;
  private changes: EditChange[] = [];

  constructor() {
    document.addEventListener("selectionchange", this.rememberCaret);
  }

  private rememberCaret = (): void => {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount !== 1) return;
    const range = selection.getRangeAt(0);
    const element =
      range.endContainer instanceof Element
        ? range.endContainer
        : range.endContainer.parentElement;
    const editable = element?.closest(
      '[contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]',
    );
    if (
      editable &&
      !containsSensitiveField(editable) &&
      !editable.closest("[data-hyperpage-ui]")
    )
      this.caret = { container: range.endContainer, offset: range.endOffset };
  };

  get canUndo(): boolean {
    return this.changes.length > 0;
  }

  prepare(
    target: Element | null,
    mode: "replace" | "insert",
    text: string,
  ): EditablePreview {
    if (
      (mode !== "replace" && mode !== "insert") ||
      typeof text !== "string" ||
      !text
    )
      throw new Error("requestInvalid");
    if (text.length > 60_000) throw new Error("editTextTooLong");
    const element = requireEditable(target);
    const control =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement;
    const before = control ? element.value : (element.textContent ?? "");
    if (before.length > 60_000) throw new Error("editTextTooLong");
    const original = control ? element.value : element.innerHTML;
    let caret: PreparedEdit["caret"] = null;
    let after = text;
    if (mode === "insert") {
      let offset: number;
      if (control) {
        if (element.selectionEnd === null)
          throw new Error("editableCaretUnavailable");
        caret = element.selectionEnd;
        offset = caret;
      } else {
        this.rememberCaret();
        if (
          !this.caret ||
          !element.contains(this.caret.container) ||
          !(
            this.caret.container instanceof Text ||
            this.caret.container instanceof Element
          )
        )
          throw new Error("editableCaretUnavailable");
        caret = { ...this.caret };
        const prefix = document.createRange();
        prefix.selectNodeContents(element);
        prefix.setEnd(caret.container, caret.offset);
        offset = prefix.toString().length;
      }
      after = before.slice(0, offset) + text + before.slice(offset);
    }
    const preview: EditablePreview = {
      id: crypto.randomUUID(),
      mode,
      before,
      after,
    };
    this.prepared = { preview, element, text, original, caret };
    return preview;
  }

  cancel(id: string): void {
    if (!this.prepared || this.prepared.preview.id !== id)
      throw new Error("editPreviewUnavailable");
    this.prepared = null;
  }

  apply(id: string): void {
    const prepared = this.prepared;
    if (!prepared || prepared.preview.id !== id)
      throw new Error("editPreviewUnavailable");
    const { element, preview, original, caret, text } = prepared;
    requireEditable(element);
    const control =
      element instanceof HTMLInputElement ||
      element instanceof HTMLTextAreaElement;
    if ((control ? element.value : element.innerHTML) !== original)
      throw new Error("editableChanged");
    let undo: () => void;
    if (control) {
      const start = element.selectionStart;
      const end = element.selectionEnd;
      undo = () => {
        setEditableValue(element, original);
        if (start !== null && end !== null)
          element.setSelectionRange(start, end);
      };
      setEditableValue(element, preview.after);
      if (element.value !== preview.after)
        throw new Error("editableUpdateRejected");
      if (typeof caret === "number") {
        element.focus();
        element.setSelectionRange(caret + text.length, caret + text.length);
      }
    } else if (preview.mode === "replace") {
      const children = Array.from(element.childNodes);
      const replacement = document.createTextNode(text);
      undo = () => {
        if (replacement.parentNode !== element)
          throw new Error("editableChanged");
        element.replaceChildren(...children);
      };
      element.replaceChildren(replacement);
    } else {
      if (
        !caret ||
        typeof caret === "number" ||
        !element.contains(caret.container)
      )
        throw new Error("editableCaretUnavailable");
      const inserted = document.createTextNode(text);
      const { container, offset } = caret;
      if (container instanceof Text) {
        const data = container.data;
        const suffix = container.splitText(offset);
        suffix.before(inserted);
        undo = () => {
          if (
            !element.contains(container) ||
            !element.contains(suffix) ||
            !element.contains(inserted)
          )
            throw new Error("editableChanged");
          inserted.remove();
          suffix.remove();
          container.data = data;
        };
      } else {
        container.insertBefore(inserted, container.childNodes[offset] ?? null);
        undo = () => {
          if (!element.contains(inserted)) throw new Error("editableChanged");
          inserted.remove();
        };
      }
      element.focus();
      const selection = window.getSelection();
      if (selection) {
        const range = document.createRange();
        range.setStartAfter(inserted);
        range.collapse(true);
        selection.removeAllRanges();
        selection.addRange(range);
      }
    }
    if (!control) {
      element.dispatchEvent(
        new InputEvent("input", { bubbles: true, data: text }),
      );
      if (element.textContent !== preview.after)
        throw new Error("editableUpdateRejected");
    }
    this.changes.push({
      element,
      expected: control ? element.value : element.innerHTML,
      kind: control ? "value" : "html",
      undo,
    });
    this.prepared = null;
  }

  undo(): void {
    const change = this.changes.at(-1);
    if (!change) throw new Error("nothingToUndo");
    requireEditable(change.element);
    const current =
      change.kind === "value" &&
      (change.element instanceof HTMLInputElement ||
        change.element instanceof HTMLTextAreaElement)
        ? change.element.value
        : change.element.innerHTML;
    if (current !== change.expected) throw new Error("editableChanged");
    change.undo();
    this.changes.pop();
    if (change.kind === "html")
      change.element.dispatchEvent(new InputEvent("input", { bubbles: true }));
  }

  destroy(): void {
    document.removeEventListener("selectionchange", this.rememberCaret);
    this.prepared = null;
    this.caret = null;
    this.changes = [];
  }
}
