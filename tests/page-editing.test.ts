import { afterEach, describe, expect, it } from "vitest";
import { PageEditing } from "../lib/page-editing";

const editors: PageEditing[] = [];
function createEditing(): PageEditing {
  const editing = new PageEditing();
  editors.push(editing);
  return editing;
}
afterEach(() => {
  editors.splice(0).forEach((editing) => editing.destroy());
  document.body.replaceChildren();
  window.getSelection()?.removeAllRanges();
});

describe("confirmed page text editing", () => {
  it("previews without writing, rejects changed content, and only undoes an unchanged result", () => {
    const field = document.createElement("textarea");
    field.value = "  original\ntext  ";
    document.body.append(field);
    const editing = createEditing();
    const preview = editing.prepare(field, "replace", "Rewritten");
    expect(preview.before).toBe(field.value);
    expect(field.value).toBe("  original\ntext  ");
    field.value = "User edited";
    expect(() => editing.apply(preview.id)).toThrow("editableChanged");
    expect(field.value).toBe("User edited");
    const next = editing.prepare(field, "replace", "AI result");
    editing.apply(next.id);
    expect(field.value).toBe("AI result");
    expect(editing.canUndo).toBe(true);
    field.value = "User edited again";
    expect(() => editing.undo()).toThrow("editableChanged");
    expect(field.value).toBe("User edited again");
  });

  it("inserts at the native caret without removing selected text and restores the prior value", () => {
    const field = document.createElement("textarea");
    field.value = "abcdef";
    document.body.append(field);
    field.setSelectionRange(1, 3);
    const editing = createEditing();
    const preview = editing.prepare(field, "insert", "NEW");
    expect(preview.after).toBe("abcNEWdef");
    editing.apply(preview.id);
    expect(field.value).toBe("abcNEWdef");
    expect(field.selectionStart).toBe(6);
    editing.undo();
    expect(field.value).toBe("abcdef");
    expect(field.selectionStart).toBe(1);
    expect(editing.canUndo).toBe(false);
  });

  it("preserves rich text nodes through cursor insertion, replacement and undo", () => {
    const element = document.createElement("div");
    element.setAttribute("contenteditable", "true");
    element.innerHTML = "<b>Bold</b><i>End</i>";
    document.body.append(element);
    const bold = element.firstChild;
    const text = bold?.firstChild;
    if (!(text instanceof Text)) throw new Error("Missing text fixture");
    const range = document.createRange();
    range.setStart(text, 2);
    range.collapse(true);
    const selection = window.getSelection();
    if (!selection) throw new Error("Missing selection");
    selection.removeAllRanges();
    selection.addRange(range);
    const editing = createEditing();
    const insertion = editing.prepare(element, "insert", "<new>");
    expect(insertion.after).toBe("Bo<new>ldEnd");
    editing.apply(insertion.id);
    expect(element.innerHTML).toBe("<b>Bo&lt;new&gt;ld</b><i>End</i>");
    editing.undo();
    expect(element.innerHTML).toBe("<b>Bold</b><i>End</i>");
    expect(bold?.firstChild).toBe(text);
    const replacement = editing.prepare(element, "replace", "Plain text");
    editing.apply(replacement.id);
    expect(element.textContent).toBe("Plain text");
    editing.undo();
    expect(element.firstChild).toBe(bold);
    expect(element.innerHTML).toBe("<b>Bold</b><i>End</i>");
  });

  it("rejects protected, readonly, detached and unsupported fields without writing", () => {
    const field = document.createElement("input");
    field.value = "original";
    document.body.append(field);
    const editing = createEditing();
    field.readOnly = true;
    expect(() => editing.prepare(field, "replace", "value")).toThrow(
      "editableRequired",
    );
    field.readOnly = false;
    const preview = editing.prepare(field, "replace", "value");
    field.autocomplete = "one-time-code";
    expect(() => editing.apply(preview.id)).toThrow("sensitiveFieldBlocked");
    expect(field.value).toBe("original");
    field.remove();
    expect(() => editing.apply(preview.id)).toThrow("editableUnavailable");
    const rich = document.createElement("div");
    rich.setAttribute("contenteditable", "true");
    rich.innerHTML = "<span hidden>Hidden</span>Visible";
    document.body.append(rich);
    expect(() => editing.prepare(rich, "replace", "value")).toThrow(
      "editableContentUnsupported",
    );
  });

  it("reports a rejected controlled-field write and invalidates cancelled previews", () => {
    const field = document.createElement("textarea");
    field.value = "Original";
    document.body.append(field);
    const editing = createEditing();
    const cancelled = editing.prepare(field, "replace", "Cancelled");
    editing.cancel(cancelled.id);
    expect(() => editing.apply(cancelled.id)).toThrow("editPreviewUnavailable");
    field.addEventListener("input", () => {
      field.value = "Original";
    });
    const preview = editing.prepare(field, "replace", "Rejected");
    expect(() => editing.apply(preview.id)).toThrow("editableUpdateRejected");
    expect(editing.canUndo).toBe(false);
  });
});
