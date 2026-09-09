import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WritingTools } from "../entrypoints/sidepanel/WritingTools";
import { TooltipProvider } from "../components/ui/tooltip";

afterEach(cleanup);
describe("writing modes", () => {
  it("collects mode, tone, length and requirements and permits composition without selected text", () => {
    const run = vi.fn();
    render(
      <TooltipProvider><WritingTools
        locale="en"
        disabled={false}
        hasSource={false}
        onRun={run}
        running={false}
        onStop={vi.fn()}
      /></TooltipProvider>,
    );
    fireEvent.click(screen.getByText("Writing assistant"));
    const generate = screen.getByRole("button", { name: "Generate writing" });
    expect(generate).toBeDisabled();
    fireEvent.click(screen.getByRole("combobox", { name: "Writing mode" }));
    const email = screen.getByRole("option", { name: "Email" });
    fireEvent.pointerDown(email);
    fireEvent.click(email);
    expect(generate).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Writing requirements"), {
      target: { value: "Invite the team" },
    });
    fireEvent.change(screen.getByLabelText("Tone"), {
      target: { value: "friendly" },
    });
    fireEvent.change(
      screen.getByLabelText("Approximate length (words or CJK characters)"),
      { target: { value: "120" } },
    );
    fireEvent.click(generate);
    expect(run).toHaveBeenCalledWith({
      mode: "email",
      tone: "friendly",
      targetLength: 120,
      instruction: "Invite the team",
    });
  });

  it("allows requirements to be empty with selected text and validates length for both submission methods", () => {
    const run = vi.fn();
    const stop = vi.fn();
    const view = render(<TooltipProvider><WritingTools locale="en" disabled={false} hasSource running={false} onRun={run} onStop={stop} /></TooltipProvider>);
    const input = screen.getByRole("textbox", { name: "Writing requirements" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(run).toHaveBeenCalledWith({ mode: "rewrite", tone: "", targetLength: null, instruction: "" });
    run.mockClear();
    fireEvent.change(screen.getByLabelText("Approximate length (words or CJK characters)"), { target: { value: "5" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Generate writing" }));
    expect(run).not.toHaveBeenCalled();
    view.rerender(<TooltipProvider><WritingTools locale="en" disabled hasSource running onRun={run} onStop={stop} /></TooltipProvider>);
    expect(input).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(stop).toHaveBeenCalledOnce();
  });
});
