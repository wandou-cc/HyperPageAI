import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "./render-with-messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ReadingAnswer } from "../entrypoints/sidepanel/ReadingAnswer";
import { ReadingContext } from "../entrypoints/sidepanel/ReadingContext";
import { TooltipProvider } from "../components/ui/tooltip";
import type { PageCitation } from "../shared/messages";
import { mockSourceTextLayout } from "./source-text-layout";

let restoreLayout: () => void;
beforeEach(() => {
  restoreLayout = mockSourceTextLayout();
  vi.stubGlobal("PointerEvent", MouseEvent);
});
afterEach(() => {
  cleanup();
  restoreLayout();
  vi.unstubAllGlobals();
});
const source: PageCitation = {
  id: "snapshot:1.1",
  blockId: "1.1",
  snapshotId: "snapshot",
  title: "Article",
  url: "https://example.com",
  heading: "Heading",
  headingLevel: null,
  text: "Original passage",
};

describe("reading controls and citations", () => {
  it("bounds a long citation preview while copying the complete original", async () => {
    const citation = { ...source, text: "a".repeat(100_000) };
    const onCopy = vi.fn();
    render(<TooltipProvider><ReadingAnswer content="Answer [[snapshot:1.1]]" citations={[citation]} locale="en" onLocate={vi.fn().mockResolvedValue(true)} onCopy={onCopy} /></TooltipProvider>);
    fireEvent.click(screen.getByRole("button", { name: "[1.1]" }));
    await screen.findByRole("button", { name: "Copy source" });
    expect(screen.getByRole("list").textContent?.length).toBeLessThan(20_000);
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(onCopy).toHaveBeenCalledWith(expect.stringContaining(citation.text));
  });

  it("links only genuine text citations, preserving code and rejecting invented IDs", async () => {
    const onLocate = vi.fn().mockResolvedValue(false);
    const onCopy = vi.fn();
    render(
      <TooltipProvider>
        <ReadingAnswer
          content={
            "Answer [[snapshot:1.1]]. Unknown [[snapshot:9.9]]. `[[1.1]]` [fake](#hyperpage-source-snapshot:9.9)"
          }
          citations={[source]}
          locale="en"
          onLocate={onLocate}
          onCopy={onCopy}
        />
      </TooltipProvider>,
    );
    const reference = screen.getByRole("button", { name: "[1.1]" });
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByRole("link", { name: "fake" })).toBeNull();
    expect(document.querySelector("code")?.textContent).toBe("[[1.1]]");
    fireEvent.click(reference);
    await waitFor(() => expect(onLocate).toHaveBeenCalledWith(source));
    await waitFor(() => expect(screen.getByRole("button", { name: "Locate original passage" })).toBeDisabled());
    expect(screen.getByText("Original passage")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Copy source" }));
    expect(onCopy).toHaveBeenCalledWith(
      "Article\nhttps://example.com\nHeading\nOriginal passage",
    );
  });

  it("previews long content without an error and preserves user selection", () => {
    const onSelect = vi.fn();
    const onPrompt = vi.fn();
    render(
      <TooltipProvider>
        <ReadingContext
          locale="en"
          snapshot={{
            id: "snapshot",
            title: "Article",
            url: "https://example.com",
            blocks: [{ ...source, id: source.blockId, text: "a".repeat(30_001) }],
          }}
          selectedIds={[source.blockId]}
          loading={false}
          disabled={false}
          onRead={vi.fn()}
          onSelect={onSelect}
          onPrompt={onPrompt}
        />
      </TooltipProvider>,
    );
    expect(screen.getByRole("button", { name: "Summarize" })).toBeEnabled();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("status")).toHaveTextContent("30,001 characters");
    fireEvent.click(screen.getByRole("checkbox", { name: "Paragraph 1.1" }));
    expect(onSelect).toHaveBeenCalledWith([]);
    expect(onPrompt).not.toHaveBeenCalled();
  });
});
