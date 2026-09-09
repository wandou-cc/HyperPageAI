import { createRef, useState } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { SourceTextView, type SourceTextViewHandle } from "../entrypoints/sidepanel/SourceTextView";
import { mockSourceTextLayout } from "./source-text-layout";
import { SnapshotPreview } from "../entrypoints/sidepanel/SnapshotPreview";

let restoreLayout: () => void;
beforeEach(() => { restoreLayout = mockSourceTextLayout(); });
afterEach(() => { cleanup(); restoreLayout(); });

const blocks = Array.from({ length: 5_000 }, (_, index) => ({
  id: `1.${index + 1}`, text: `Subtitle ${index + 1}`, heading: `${index}:00`, headingLevel: null, timeSeconds: index * 60,
}));

describe("source text viewport", () => {
  it("keeps archived original context virtualized while editing a question", () => {
    render(<SnapshotPreview locale="en" snapshot={{ type: "page", page: { id: "archived", title: "Saved video", url: "https://example.com", blocks } }} />);
    expect(screen.getByText("Saved video")).toBeVisible();
    expect(screen.getByText("Subtitle 1")).toBeVisible();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    expect(screen.queryByText("Subtitle 5000")).toBeNull();
    const list = screen.getByRole("list");
    act(() => list.scrollTo({ top: list.scrollHeight }));
    expect(screen.getByText("Subtitle 5000")).toBeVisible();
  });

  it("bounds mounted subtitle rows while scrolling and retains selection after rows unmount", async () => {
    function Preview() {
      const [selected, setSelected] = useState(blocks.map((block) => block.id));
      return <SourceTextView locale="en" blocks={blocks} selectedIds={selected} onSelect={setSelected} />;
    }
    render(<Preview />);
    expect(screen.getByText("Subtitle 1")).toBeVisible();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    expect(screen.queryByText("Subtitle 5000")).toBeNull();
    fireEvent.click(screen.getByRole("checkbox", { name: "Paragraph 1.1" }));
    const list = screen.getByRole("list");
    act(() => list.scrollTo({ top: 104 * 4_900 }));
    await screen.findByText("Subtitle 4901");
    expect(screen.queryByText("Subtitle 1")).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    act(() => list.scrollTo({ top: 0 }));
    expect(await screen.findByRole("checkbox", { name: "Paragraph 1.1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Paragraph 1.2" })).toBeChecked();
  });

  it("keeps a huge paragraph intact across bounded display rows, including surrogate pairs", () => {
    const text = "a".repeat(1_999) + "\uD83D\uDE00" + "b".repeat(120_000);
    const { container } = render(<SourceTextView locale="en" blocks={[{ ...blocks[0]!, text }]} />);
    const list = screen.getByRole("list");
    const collected = new Map<number, string>();
    const count = Number(screen.getAllByRole("listitem")[0]?.getAttribute("aria-setsize"));
    for (let index = 0; index < count; index += 3) {
      act(() => list.scrollTo({ top: 104 * index }));
      for (const row of container.querySelectorAll<HTMLElement>("[data-source-row]")) {
        const value = row.querySelector("p")?.textContent ?? "";
        expect(value.length).toBeLessThanOrEqual(2_000);
        expect(/[\uD800-\uDBFF]$/.test(value)).toBe(false);
        expect(/^[\uDC00-\uDFFF]/.test(value)).toBe(false);
        collected.set(Number(row.dataset.index), value);
      }
      expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    }
    expect([...collected].sort(([a], [b]) => a - b).map(([, value]) => value).join("")).toBe(text);
  });

  it("reveals unmounted PDF pages and citation targets, then resets on source replacement", async () => {
    const ref = createRef<SourceTextViewHandle>();
    const fileBlocks = blocks.slice(0, 500).map((block, index) => ({ ...block, id: `${index + 1}.1`, pageNumber: index + 1 }));
    const view = render(<SourceTextView key="first" ref={ref} locale="en" blocks={fileBlocks} pageCount={500} />);
    expect(screen.queryByText("Page 450")).toBeNull();
    act(() => { expect(ref.current?.scrollToPage(450)).toBe(true); });
    await waitFor(() => expect(screen.getByText("Page 450").closest("[data-source-row]")).toHaveFocus());
    act(() => { expect(ref.current?.scrollToBlock("490.1")).toBe(true); });
    await waitFor(() => expect(screen.getByText("Subtitle 490").closest("[data-source-row]")).toHaveFocus());
    expect(ref.current?.scrollToBlock("missing")).toBe(false);
    view.rerender(<SourceTextView key="second" ref={ref} locale="en" blocks={[{ ...blocks[0]!, text: "New source" }]} />);
    expect(screen.getByRole("list").scrollTop).toBe(0);
    expect(screen.getByText("New source")).toBeVisible();
    expect(screen.queryByText("Subtitle 490")).toBeNull();
  });
});
