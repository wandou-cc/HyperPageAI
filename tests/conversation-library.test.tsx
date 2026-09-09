import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "./render-with-messages";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { ConversationLibrary } from "../entrypoints/sidepanel/ConversationLibrary";
import { TextExport } from "../entrypoints/sidepanel/TextExport";
import {
  CONVERSATION_STORAGE_PREFIX,
  type ConversationTurn,
} from "../shared/conversations";

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  remove: vi.fn(),
  addListener: vi.fn(),
  removeListener: vi.fn(),
}));
vi.mock("wxt/browser", () => ({
  browser: {
    storage: {
      local: { get: mocks.get, set: mocks.set, remove: mocks.remove },
      onChanged: {
        addListener: mocks.addListener,
        removeListener: mocks.removeListener,
      },
    },
  },
}));
const turns: ConversationTurn[] = [
  {
    id: "turn",
    prompt: "My question",
    answer: "My answer",
    snapshot: { type: "none" },
    includeHistory: true,
    status: "complete",
  },
];
let stored: Record<string, unknown>;
beforeEach(() => {
  stored = {};
  vi.clearAllMocks();
  mocks.get.mockImplementation(async () => ({ ...stored }));
  mocks.set.mockImplementation(async (values) => {
    Object.assign(stored, values);
  });
  mocks.remove.mockImplementation(async (key) => {
    delete stored[key];
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("conversation library", () => {
  it("only persists after saving, and supports search, open, rename and deletion", async () => {
    const onLoad = vi.fn();
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <ConversationLibrary
          locale="en"
          turns={turns}
          current={null}
          disabled={false}
          onLoad={onLoad}
          onSaved={onSaved}
        />
      </TooltipProvider>,
    );
    expect(await screen.findByText("No matching conversations")).toBeVisible();
    expect(mocks.set).not.toHaveBeenCalled();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation name" }),
      { target: { value: "Saved question" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save conversation" }));
    expect(await screen.findByText("Saved question")).toBeVisible();
    expect(Object.keys(stored)[0]).toMatch(
      new RegExp(`^${CONVERSATION_STORAGE_PREFIX}`),
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search conversations" }),
      { target: { value: "not present" } },
    );
    expect(screen.getByText("No matching conversations")).toBeVisible();
    fireEvent.change(
      screen.getByRole("textbox", { name: "Search conversations" }),
      { target: { value: "My answer" } },
    );
    expect(screen.getByText("Saved question")).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Saved question" }));
    expect(onLoad).toHaveBeenCalledWith(
      expect.objectContaining({ name: "Saved question", turns }),
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Rename conversation" }),
    );
    const renameInput = screen.getAllByRole("textbox", {
      name: "Conversation name",
    })[1];
    if (!renameInput) throw new Error("Missing rename input");
    fireEvent.change(renameInput, { target: { value: "Renamed" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Renamed")).toBeVisible();
    fireEvent.click(
      screen.getByRole("button", { name: "Delete conversation" }),
    );
    await waitFor(() => expect(Object.keys(stored)).toHaveLength(0));
  });

  it("reports failed storage writes and keeps unsaved input available", async () => {
    mocks.set.mockRejectedValue(new Error("QUOTA_BYTES exceeded"));
    const onSaved = vi.fn();
    render(
      <TooltipProvider>
        <ConversationLibrary
          locale="en"
          turns={turns}
          current={null}
          disabled={false}
          onLoad={vi.fn()}
          onSaved={onSaved}
        />
      </TooltipProvider>,
    );
    fireEvent.change(
      screen.getByRole("textbox", { name: "Conversation name" }),
      { target: { value: "Unsaved" } },
    );
    fireEvent.click(screen.getByRole("button", { name: "Save conversation" }));
    expect(await screen.findByRole("alertdialog", { hidden: true })).toHaveTextContent("QUOTA_BYTES exceeded");
    expect(
      screen.getByRole("textbox", { name: "Conversation name" }),
    ).toHaveValue("Unsaved");
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("creates a plain-text download only when the export control is invoked", async () => {
    const create = vi.fn((_blob: Blob) => "blob:export");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: create,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    let downloaded = "";
    const click = vi
      .spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(function (this: HTMLAnchorElement) {
        downloaded = this.download;
      });
    const content = vi.fn(() => "# Heading\n\n**Body**");
    render(
      <TooltipProvider>
        <TextExport locale="en" content={content} filename="answer" />
      </TooltipProvider>,
    );
    expect(content).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("combobox", { name: "Export format" }));
    const plainText = screen.getByRole("option", { name: "Plain text" });
    fireEvent.pointerDown(plainText);
    fireEvent.click(plainText);
    fireEvent.click(screen.getByRole("button", { name: "Export text" }));
    expect(click).toHaveBeenCalledOnce();
    expect(downloaded).toBe("answer.txt");
    const blob = create.mock.calls[0]?.[0];
    if (!blob) throw new Error("Missing export blob");
    const reader = new FileReader();
    const text = new Promise((resolve) => {
      reader.onload = () => resolve(reader.result);
    });
    reader.readAsText(blob);
    await expect(text).resolves.toBe("Heading\n\nBody");
  });
});
