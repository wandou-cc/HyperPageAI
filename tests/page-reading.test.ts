import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageReading } from "../lib/page-reading";
import {
  buildPageReadingContent,
  getReadingCharacters,
} from "../shared/page-reading";

let reading: PageReading;

beforeEach(() => {
  reading = new PageReading();
  document.title = "Reading fixture";
  window.history.replaceState(null, "", "/article");
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Range.prototype, "getBoundingClientRect", {
    configurable: true,
    value: vi.fn(() => ({ left: 10, top: 20, width: 100, height: 30 })),
  });
});

afterEach(() => {
  reading.clear();
  vi.restoreAllMocks();
});

describe("page reading", () => {
  it("reads only a selected inline root and keeps citations valid when surrounding text changes", () => {
    document.body.innerHTML = "<p>Before <span>Selected <b>text</b></span> after.</p><p>Excluded</p>";
    const root = document.querySelector("span");
    if (!root) throw new Error("Missing fixture");
    const snapshot = reading.read(root);
    expect(snapshot.blocks.map((block) => block.text)).toEqual(["Selected text"]);
    const block = snapshot.blocks[0];
    if (!block) throw new Error("Missing block");
    root.previousSibling?.replaceWith("Changed surroundings ");
    reading.locate(snapshot.id, block.id);
    expect(root.parentElement?.scrollIntoView).toHaveBeenCalledOnce();
    root.append(" changed");
    expect(() => reading.locate(snapshot.id, block.id)).toThrow("citationUnavailable");
  });

  it("extracts ordered, nonduplicated text and headings without reading form values", () => {
    document.body.innerHTML = `
      <main><h1>Article</h1><p>First <strong>paragraph</strong>.</p>
      <h2>Details</h2><div>Intro<p>Nested passage</p>After</div>
      <p style="position:absolute;top:10000px">Offscreen passage</p>
      <input value="private"><textarea>private</textarea><select><option>private</option></select>
      <div contenteditable="true">private</div><div autocomplete="one-time-code">private</div>
      <section style="display:none"><p>private</p></section><p hidden>private</p>
      <div aria-hidden="true">private</div><div style="opacity:0">private</div>
      <script>private()</script><style>.private {}</style><iframe srcdoc="private"></iframe>
      <div data-hyperpage-ui="panel">private</div>
      <details><summary>Visible summary</summary><p>private</p></details>
      </main>`;
    vi.spyOn(HTMLInputElement.prototype, "value", "get").mockImplementation(
      () => {
        throw new Error("Input read");
      },
    );
    vi.spyOn(HTMLTextAreaElement.prototype, "value", "get").mockImplementation(
      () => {
        throw new Error("Textarea read");
      },
    );
    const snapshot = reading.read();
    expect(snapshot.blocks.map((block) => block.text)).toEqual([
      "Article",
      "First paragraph.",
      "Details",
      "Intro",
      "Nested passage",
      "After",
      "Offscreen passage",
      "Visible summary",
    ]);
    expect(snapshot.blocks[3]?.heading).toBe("Article / Details");
    expect(snapshot.blocks[2]?.headingLevel).toBe(2);
    expect(JSON.stringify(snapshot)).not.toContain("private");
    expect(getReadingCharacters(snapshot)).toBe(
      snapshot.blocks.reduce((sum, block) => sum + block.text.length, 0),
    );
  });

  it("sends the exact preview snapshot and only chosen blocks", () => {
    document.body.innerHTML = "<p>Original passage</p><p>Second passage</p>";
    const snapshot = reading.read();
    const block = snapshot.blocks[0];
    if (!block) throw new Error("Missing fixture block");
    document.querySelector("p")?.append(" changed");
    const selected = reading.select({
      snapshotId: snapshot.id,
      blockIds: [block.id],
    });
    expect(selected.blocks).toEqual([block]);
    expect(buildPageReadingContent("Summarize", selected)).toContain(
      "Original passage",
    );
    expect(buildPageReadingContent("Summarize", selected)).not.toContain(
      "Second passage",
    );
    expect(buildPageReadingContent("Summarize", selected)).not.toContain(
      "changed",
    );
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
  });

  it("preserves long originals through selection and refuses empty or forged selections", () => {
    document.body.innerHTML = `<p>${"a".repeat(100_000)}</p><p>Small</p>`;
    const snapshot = reading.read();
    const [large, small] = snapshot.blocks;
    if (!large || !small) throw new Error("Missing fixture blocks");
    expect(large.text).toHaveLength(100_000);
    expect(reading.select({ snapshotId: snapshot.id, blockIds: [large.id] }).blocks).toEqual([large]);
    expect(
      reading.select({ snapshotId: snapshot.id, blockIds: [small.id] }).blocks,
    ).toEqual([small]);
    for (const blockIds of [[], ["unknown"], [small.id, small.id]]) {
      expect(() =>
        reading.select({ snapshotId: snapshot.id, blockIds }),
      ).toThrow("pageReadingSelectionInvalid");
    }
  });

  it("locates the real node and rejects replaced, edited or hidden originals", () => {
    document.body.innerHTML = "<p>Original</p>";
    const snapshot = reading.read();
    const block = snapshot.blocks[0];
    const element = document.querySelector("p");
    if (!block || !element) throw new Error("Missing fixture");
    reading.locate(snapshot.id, block.id);
    expect(element.scrollIntoView).toHaveBeenCalledOnce();
    expect(
      document.querySelector('[data-hyperpage-ui="citation"]'),
    ).not.toBeNull();
    element.hidden = true;
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
    element.hidden = false;
    if (!element.firstChild) throw new Error("Missing text");
    element.firstChild.textContent = "Changed";
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
    element.replaceChildren(document.createTextNode("Original"));
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
  });

  it("invalidates citations and sends after navigation, deletion or session clearing", () => {
    document.body.innerHTML = "<p>Original</p>";
    const snapshot = reading.read();
    const block = snapshot.blocks[0];
    if (!block) throw new Error("Missing fixture");
    window.history.replaceState(null, "", "/another");
    expect(() =>
      reading.select({ snapshotId: snapshot.id, blockIds: [block.id] }),
    ).toThrow("pageReadingUnavailable");
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
    window.history.replaceState(null, "", "/article");
    document.querySelector("p")?.remove();
    expect(() => reading.locate(snapshot.id, block.id)).toThrow(
      "citationUnavailable",
    );
    reading.clear();
    expect(() =>
      reading.select({ snapshotId: snapshot.id, blockIds: [block.id] }),
    ).toThrow("pageReadingUnavailable");
  });

  it("rejects empty pages without inventing content", () => {
    document.body.innerHTML =
      "<input value='only form values'><div hidden>Hidden</div>";
    expect(() => reading.read()).toThrow("pageReadingEmpty");
  });
});
