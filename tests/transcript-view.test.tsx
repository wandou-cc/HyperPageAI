import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { TranscriptView } from "../entrypoints/sidepanel/TranscriptView";
import { getTranscriptParagraphs } from "../shared/video";
import { mockSourceTextLayout } from "./source-text-layout";

let restoreLayout: () => void;
beforeEach(() => { restoreLayout = mockSourceTextLayout(); });
afterEach(() => { cleanup(); restoreLayout(); });

describe("subtitle display modes", () => {
  it("reflows existing sentences without rewriting text or inserting spaces at CJK cue boundaries", () => {
    expect(getTranscriptParagraphs([{ text: "First line\ncontinues" }, { text: "here. Another sentence." }])).toEqual(["First line continues here. Another sentence."]);
    expect(getTranscriptParagraphs([{ text: "\u4f60\u597d" }, { text: "\u4e16\u754c\u3002" }, { text: "\u4e0b\u4e00\u53e5\u3002" }])).toEqual(["\u4f60\u597d\u4e16\u754c\u3002\u4e0b\u4e00\u53e5\u3002"]);
    const blocks = Array.from({ length: 100 }, (_, index) => ({ text: `Sentence ${index}.` }));
    const paragraphs = getTranscriptParagraphs(blocks);
    expect(paragraphs.length).toBeGreaterThan(1);
    expect(paragraphs.join(" ")).toBe(blocks.map((block) => block.text).join(" "));
  });

  it("keeps both modes virtualized and retains the original selection and timestamps", async () => {
    const blocks = Array.from({ length: 5_000 }, (_, index) => Object.freeze({
      id: `1.${index + 1}`, text: `Passage ${index + 1}.`, heading: `${index}:00`, headingLevel: null, timeSeconds: index * 60,
    }));
    function View() {
      const [selected, setSelected] = useState<string[]>(blocks.map((block) => block.id));
      return <TranscriptView locale="en" blocks={blocks} selectedIds={selected} onSelect={setSelected} disabled={false} className="h-80" />;
    }
    render(<View />);
    expect(screen.getByRole("button", { name: "Timestamps" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("0:00")).toBeVisible();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    fireEvent.click(screen.getByRole("checkbox", { name: "Paragraph 1.1" }));
    fireEvent.click(screen.getByRole("button", { name: "Body text" }));
    expect(screen.getByRole("button", { name: "Body text" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.queryByText("0:00")).toBeNull();
    expect(screen.queryByRole("checkbox")).toBeNull();
    expect(screen.getByText(/Passage 1\. Passage 2\./)).toBeVisible();
    expect(screen.queryByText(/Passage 5000\./)).toBeNull();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    const list = screen.getByRole("list");
    act(() => list.scrollTo({ top: list.scrollHeight }));
    expect(await screen.findByText(/Passage 5000\./)).toBeVisible();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    fireEvent.click(screen.getByRole("button", { name: "Timestamps" }));
    expect(screen.getByText("0:00")).toBeVisible();
    expect(screen.getByRole("checkbox", { name: "Paragraph 1.1" })).not.toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Paragraph 1.2" })).toBeChecked();
    expect(blocks[0]).toMatchObject({ text: "Passage 1.", timeSeconds: 0 });
  });
});
