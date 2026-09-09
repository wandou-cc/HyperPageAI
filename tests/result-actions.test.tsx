import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { ResultActions } from "../entrypoints/sidepanel/ResultActions";
import type { BackgroundRequest, PageState } from "../shared/messages";
import { createSelectionSnapshot } from "../shared/selection";

const sendMessage = vi.hoisted(() => vi.fn());
vi.mock("wxt/browser", () => ({ browser: { runtime: { sendMessage } } }));
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("result editing controls", () => {
  it("explains where each result action applies", async () => {
    const state: PageState = {
      selection: null,
      selectionRevision: 1,
      selecting: false,
      canUndoReplace: false,
      canRemoveInsertion: false,
    };
    render(
      <TooltipProvider>
        <ResultActions
          text="New text"
          locale="en"
          state={state}
          disabled={false}
          onState={vi.fn()}
          onError={vi.fn()}
        />
      </TooltipProvider>,
    );

    const cases = [
      ["Insert below", "Insert this result below the selected page element."],
      [
        "Replace field",
        "Replace all content in the selected input area with this result.",
      ],
      [
        "Insert at cursor",
        "Insert this result at the cursor in the selected input area.",
      ],
    ] as const;
    for (const [buttonName, hint] of cases) {
      const button = screen.getByRole("button", { name: buttonName });
      expect(button).toBeDisabled();
      const trigger = button.parentElement;
      if (!trigger) throw new Error("Missing disabled tooltip trigger");
      fireEvent.mouseEnter(trigger);
      expect(await screen.findByText(hint)).toBeVisible();
      fireEvent.mouseLeave(trigger);
      await waitFor(() => expect(screen.queryByText(hint)).toBeNull());
    }
  });

  it("shows differences and only sends the approved preview token after confirmation", async () => {
    const field = document.createElement("textarea");
    field.value = "Old text";
    const state: PageState = {
      selection: createSelectionSnapshot(field),
      selectionRevision: 7,
      selecting: false,
      canUndoReplace: false,
      canRemoveInsertion: false,
    };
    sendMessage.mockImplementation(async (request: BackgroundRequest) => ({
      ok: true,
      data:
        request.type === "editing-command" &&
        request.command.type === "prepare-edit"
          ? {
              id: "preview",
              mode: "replace",
              before: "Old text",
              after: "New text",
            }
          : state,
    }));
    const onState = vi.fn();
    render(
      <TooltipProvider>
        <ResultActions
          text="New text"
          locale="en"
          state={state}
          disabled={false}
          onState={onState}
          onError={vi.fn()}
        />
      </TooltipProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Replace field" }));
    expect(
      await screen.findByRole("region", { name: "Edit preview" }),
    ).toBeVisible();
    expect(sendMessage).toHaveBeenCalledExactlyOnceWith({
      target: "background",
      type: "editing-command",
      command: {
        type: "prepare-edit",
        mode: "replace",
        text: "New text",
        selectionRevision: 7,
      },
    });
    expect(document.querySelector("del")).toHaveTextContent("Old");
    expect(document.querySelector("ins")).toHaveTextContent("New");
    fireEvent.click(screen.getByRole("button", { name: "Confirm edit" }));
    await waitFor(() => expect(onState).toHaveBeenCalledWith(state));
    expect(sendMessage).toHaveBeenLastCalledWith({
      target: "background",
      type: "editing-command",
      command: { type: "apply-edit", previewId: "preview" },
    });
  });
});
