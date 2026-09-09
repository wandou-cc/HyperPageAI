import { useState } from "react";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { SourceWorkspace } from "../entrypoints/sidepanel/SourceWorkspace";

afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

it("retains inputs while switching source and chat views and makes both panes interactive on wide screens", () => {
  const changed = new Set<() => void>();
  const media = { matches: false, addEventListener: (_type: string, listener: () => void) => changed.add(listener), removeEventListener: (_type: string, listener: () => void) => changed.delete(listener) };
  vi.stubGlobal("matchMedia", () => media);
  function Workspace() {
    const [view, setView] = useState("sources");
    return <SourceWorkspace locale="en" view={view} onViewChange={setView} conversation={<textarea aria-label="Question" />}><input aria-label="Source URL" /></SourceWorkspace>;
  }
  render(<Workspace />);
  const source = screen.getByRole("textbox", { name: "Source URL" });
  fireEvent.change(source, { target: { value: "https://example.com" } });
  fireEvent.click(screen.getByRole("tab", { name: "Chat" }));
  const question = screen.getByRole("textbox", { name: "Question" });
    fireEvent.change(question, { target: { value: "Summarize this document" } });
  expect(source).not.toBeVisible();
  fireEvent.click(screen.getByRole("tab", { name: "Sources" }));
  expect(screen.getByRole("textbox", { name: "Source URL" })).toBe(source);
  expect(source).toHaveValue("https://example.com");
  expect(question).toHaveValue("Summarize this document");

  act(() => { media.matches = true; changed.forEach((listener) => listener()); });
  for (const pane of screen.getAllByRole("tabpanel")) {
    expect(pane).toBeVisible();
    expect(pane).not.toHaveAttribute("inert");
  }
  expect(screen.getByRole("textbox", { name: "Question" })).toBe(question);
  act(() => { media.matches = false; changed.forEach((listener) => listener()); });
  expect(question).not.toBeVisible();
});
