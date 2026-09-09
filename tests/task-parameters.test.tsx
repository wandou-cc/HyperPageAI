import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TemplateParameters } from "../entrypoints/sidepanel/TemplateParameters";

afterEach(cleanup);
describe("task parameter input", () => {
  it("requires every parameter and previews the exact task before running", () => {
    const run = vi.fn();
    const cancel = vi.fn();
    render(
      <TemplateParameters
        action="run"
        template="Find {{query}} on {{site}}"
        locale="en"
        onRun={run}
        onCancel={cancel}
      />,
    );
    const start = screen.getByRole("button", { name: "Start" });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("query"), {
      target: { value: "local models" },
    });
    expect(start).toBeDisabled();
    fireEvent.change(screen.getByLabelText("site"), {
      target: { value: "example.com" },
    });
    expect(screen.getByLabelText("Page task")).toHaveTextContent(
      "Find local models on example.com",
    );
    fireEvent.click(start);
    expect(run).toHaveBeenCalledWith("Find local models on example.com");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(cancel).toHaveBeenCalledOnce();
  });
});
