import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AiComposer } from "../entrypoints/sidepanel/AiComposer";
import { TooltipProvider } from "../components/ui/tooltip";

afterEach(cleanup);

describe("AI composer", () => {
  it("applies the same submission guard to Enter and the button, preserving newlines and IME input", () => {
    const onSubmit = vi.fn();
    const props = { locale: "en" as const, value: "Question", onChange: vi.fn(), onSubmit };
    const view = render(<TooltipProvider><AiComposer {...props} canSubmit={false} /></TooltipProvider>);
    const input = screen.getByRole("textbox");
    expect(screen.getByRole("button", { name: "Send message" })).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    view.rerender(<TooltipProvider><AiComposer {...props} canSubmit /></TooltipProvider>);
    expect(fireEvent.keyDown(input, { key: "Enter", shiftKey: true })).toBe(true);
    expect(fireEvent.keyDown(input, { key: "Enter", isComposing: true })).toBe(true);
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(onSubmit).toHaveBeenCalledTimes(2);
  });

  it("blocks additional submissions while running and keeps cancellation available", () => {
    const onSubmit = vi.fn();
    const onStop = vi.fn();
    render(<TooltipProvider><AiComposer locale="en" value="Task" onChange={vi.fn()} disabled canSubmit running onSubmit={onSubmit} onStop={onStop} /></TooltipProvider>);
    const input = screen.getByRole("textbox");
    expect(input).toBeDisabled();
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Send message" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(onStop).toHaveBeenCalledOnce();
  });
});
