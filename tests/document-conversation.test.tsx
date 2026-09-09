import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { SourceConversation } from "../entrypoints/sidepanel/SourceConversation";
import type { FileReadingSnapshot } from "../shared/messages";
import { browser } from "wxt/browser";

const port = vi.hoisted(() => ({
  postMessage: vi.fn(),
  disconnect: vi.fn(),
  onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
}));
vi.mock("wxt/browser", () => ({
  browser: { runtime: { connect: vi.fn(() => port) } },
}));
const file: FileReadingSnapshot = {
  id: crypto.randomUUID(),
  name: "report.pdf",
  format: "pdf",
  pageCount: 2,
  blocks: [
    {
      id: "1.1",
      text: "First page",
      heading: "",
      headingLevel: null,
      pageNumber: 1,
    },
    {
      id: "2.1",
      text: "Second page",
      heading: "",
      headingLevel: null,
      pageNumber: 2,
    },
  ],
};
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(cleanup);

describe("document conversation controls", () => {
  it("sends the loaded document only after submission and offers cancellation", async () => {
    render(
      <TooltipProvider>
        <SourceConversation
          children={<p>Document body</p>}
          locale="en"
          source={{ type: "file", file }}
          disabled={false}
          onLocate={vi.fn()}
          onBusy={vi.fn()}
          onError={vi.fn()}
        />
      </TooltipProvider>,
    );
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(screen.getByText("Document body")).toBeVisible();
    expect(screen.queryByRole("heading", { name: "Document conversation" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Answers" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Choose text file" }),
    ).not.toBeInTheDocument();
    const prompt = screen.getByRole("textbox");
    fireEvent.change(prompt, { target: { value: "Explain the second page" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(screen.getByText("Document body")).not.toBeVisible();
    expect(screen.getByRole("tab", { name: "Answers" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox")).toBe(prompt);
    fireEvent.click(screen.getByRole("tab", { name: "Preview" }));
    expect(screen.getByText("Document body")).toBeVisible();
    const sent = port.postMessage.mock.calls[0]?.[0];
    expect(sent).toMatchObject({
      type: "run",
      request: {
        snapshot: { type: "file", file },
        includeHistory: true,
        history: [],
        webSearch: false,
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Stop generating" }));
    expect(port.postMessage).toHaveBeenLastCalledWith({
      type: "cancel",
      requestId: sent.requestId,
    });
    const receive = port.onMessage.addListener.mock.calls[0]?.[0];
    if (!receive) throw new Error("Missing document result handler");
    act(() =>
      receive({
        type: "result",
        requestId: sent.requestId,
        result: { ok: false, error: "requestCancelled" },
      }),
    );
    expect(prompt).toHaveValue("Explain the second page");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
  });

  it("restores a draft after disconnection and releases its port on unmount", () => {
    const onError = vi.fn();
    const view = render(
      <TooltipProvider>
        <SourceConversation
          children={<p>Document body</p>}
          locale="en"
          source={{ type: "file", file }}
          disabled={false}
          onLocate={vi.fn()}
          onBusy={vi.fn()}
          onError={onError}
        />
      </TooltipProvider>,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "Question" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    const disconnect = port.onDisconnect.addListener.mock.calls[0]?.[0];
    if (!disconnect) throw new Error("Missing document disconnect handler");
    act(disconnect);
    expect(screen.getByRole("textbox")).toHaveValue("Question");
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    expect(onError).toHaveBeenCalledWith(
      "The request was interrupted. Your question has been kept.",
    );
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(browser.runtime.connect).toHaveBeenCalledTimes(2);
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({
      request: expect.objectContaining({ prompt: "Question", includeHistory: true, history: [] }),
    }));
    view.unmount();
    expect(port.disconnect).toHaveBeenCalledOnce();
  });

  it("previews a long source without errors and sends it intact only on submission", () => {
    const onError = vi.fn();
    const source = { type: "file" as const, file: {
      ...file,
      blocks: [{ id: "1.1", text: "A".repeat(100_000), heading: "", headingLevel: null, pageNumber: 1 }],
    } };
    const props = { locale: "en" as const, source, disabled: false, onLocate: vi.fn(), onBusy: vi.fn(), onError, children: <p>Document body</p> };
    render(<TooltipProvider><SourceConversation {...props} /></TooltipProvider>);
    expect(onError).not.toHaveBeenCalled();
    expect(port.postMessage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Summarize" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter" });
    expect(onError).not.toHaveBeenCalled();
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({
      request: expect.objectContaining({ snapshot: source, includeHistory: true }),
    }));
  });

  it.each([true, false])("reveals the source for citation lookup and handles location availability: %s", async (available) => {
    const onLocate = vi.fn(async () => {
      expect(screen.getByText("Document body")).toBeVisible();
      return available;
    });
    render(<TooltipProvider>
      <SourceConversation locale="en" source={{ type: "file", file }} disabled={false} onLocate={onLocate} onBusy={vi.fn()} onError={vi.fn()}>
        <p>Document body</p>
      </SourceConversation>
    </TooltipProvider>);
    const prompt = screen.getByRole("textbox");
    fireEvent.change(prompt, { target: { value: "Explain" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    const sent = port.postMessage.mock.calls[0]?.[0];
    const receive = port.onMessage.addListener.mock.calls[0]?.[0];
    act(() => receive({ type: "result", requestId: sent.requestId, result: { ok: true, data: { content: `Answer [[${file.id}:2.1]]` } } }));
    fireEvent.click(screen.getByRole("button", { name: "[2.1]" }));
    await waitFor(() => expect(onLocate).toHaveBeenCalledWith(expect.objectContaining({ documentId: file.id, pageNumber: 2 })));
    await waitFor(() => expect(screen.getByRole("tab", { name: "Preview" })).toHaveAttribute("aria-selected", String(available)));
    if (!available) expect(screen.getByRole("button", { name: "Locate original passage" })).toBeDisabled();
    fireEvent.change(prompt, { target: { value: "Follow-up" } });
    fireEvent.click(screen.getByRole("tab", { name: "Answers" }));
    expect(prompt).toHaveValue("Follow-up");
    fireEvent.click(screen.getByRole("button", { name: "New chat" }));
    expect(screen.getByText("Document body")).toBeVisible();
    expect(screen.queryByRole("tab", { name: "Answers" })).toBeNull();
    expect(prompt).toHaveValue("");
  });
});
