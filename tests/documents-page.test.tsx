import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { readFileSync } from "node:fs";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "../components/ui/tooltip";
import { DocumentsPage } from "../entrypoints/documents/DocumentsPage";
import { requestPageResource } from "../entrypoints/documents/resource-client";
import { createDefaultSettings, loadSettings } from "../shared/settings";
import type { ResourceCatalog } from "../shared/page-resources";
import { mockSourceTextLayout } from "./source-text-layout";

const port = vi.hoisted(() => ({
  postMessage: vi.fn(), disconnect: vi.fn(),
  onMessage: { addListener: vi.fn(), removeListener: vi.fn() },
  onDisconnect: { addListener: vi.fn(), removeListener: vi.fn() },
}));
vi.mock("wxt/browser", () => ({ browser: {
  runtime: { connect: vi.fn(() => port), getURL: (path: string) => `chrome-extension://test${path}`, sendMessage: vi.fn() },
  storage: { onChanged: { addListener: vi.fn(), removeListener: vi.fn() } },
  i18n: { getUILanguage: () => "en" },
} }));
vi.mock("../shared/settings", async (original) => ({ ...await original<typeof import("../shared/settings")>(), loadSettings: vi.fn() }));
vi.mock("../entrypoints/documents/resource-client", () => ({ requestPageResource: vi.fn() }));
vi.mock("pdfjs-dist/legacy/build/pdf.mjs", () => ({ GlobalWorkerOptions: {} }));
vi.mock("../lib/pdf-reading", () => ({ loadPdfFile: vi.fn() }));

const catalog: ResourceCatalog = { type: "catalog", url: "https://example.com", title: "Research page", resources: [
  { id: crypto.randomUUID(), kind: "document", name: "Research notes", url: "https://example.com/notes.txt", format: "txt", reader: "text" },
  { id: crypto.randomUUID(), kind: "image", name: "Revenue chart", url: "https://example.com/chart.png", format: "png", reader: "image" },
  { id: crypto.randomUUID(), kind: "video", name: "Recording", url: "https://example.com/video.mp4", format: "mp4", reader: null },
] };
let restoreLayout: () => void;
beforeEach(() => {
  vi.clearAllMocks();
  restoreLayout = mockSourceTextLayout();
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  vi.mocked(loadSettings).mockResolvedValue(createDefaultSettings("en"));
  vi.mocked(requestPageResource).mockResolvedValue(catalog);
});
afterEach(() => { cleanup(); restoreLayout(); vi.unstubAllGlobals(); });

describe("source page", () => {
  it.each(["youtube", "transcript"] as const)("previews large %s subtitles in both modes and sends only selected original passages", async (reader) => {
    const video = { id: crypto.randomUUID(), kind: "video" as const, name: "Lecture", url: "https://www.youtube.com/watch?v=ToK8L3b-aCA", format: reader, reader };
    vi.mocked(requestPageResource).mockResolvedValueOnce({ ...catalog, resources: [video] });
    render(<TooltipProvider><DocumentsPage embedded /></TooltipProvider>);
    await screen.findByRole("tab", { name: "Videos 1" });
    fireEvent.click(screen.getByRole("tab", { name: "Videos 1" }));
    const page = { id: "subtitles", videoId: "ToK8L3b-aCA", title: "Lecture", url: video.url, blocks: Array.from({ length: 5_000 }, (_, index) => ({
      id: `1.${index + 1}`, text: `Original subtitle ${index + 1}`, heading: `${index}:00`, headingLevel: null, timeSeconds: index * 60,
    })) };
    const file = { id: crypto.randomUUID(), name: video.name, format: "text" as const, pageCount: 1,
      blocks: page.blocks.map(({ id, text, heading, headingLevel }) => ({ id, text, heading, headingLevel, pageNumber: 1 })),
    };
    vi.mocked(requestPageResource).mockResolvedValueOnce(reader === "youtube" ? { type: "page", page } : { type: "file", file });
    fireEvent.click(screen.getByRole("button", { name: "Lecture" }));
    expect(await screen.findByText("Original subtitle 1")).toBeVisible();
    expect(screen.getAllByRole("listitem").length).toBeLessThan(20);
    expect(screen.queryByText("Original subtitle 5000")).toBeNull();
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toHaveValue("");
    expect(screen.queryByRole("button", { name: /summarize|chapters/i })).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Body text" }));
    expect(screen.queryByText("0:00")).toBeNull();
    expect(screen.getByText(/Original subtitle 1 Original subtitle 2/)).toBeVisible();
    expect(port.postMessage).not.toHaveBeenCalled();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Translate this passage" } });
    expect(screen.getByRole("button", { name: "Send message" })).toBeEnabled();
    fireEvent.click(screen.getByRole("button", { name: "Timestamps" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Select all" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Paragraph 1.1" }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Translate this passage" } });
    expect(port.postMessage).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(port.postMessage).toHaveBeenCalledOnce();
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({
      prompt: "Translate this passage", snapshot: reader === "youtube"
        ? { type: "page", page: { ...page, blocks: [page.blocks[0]] } }
        : { type: "file", file: { ...file, blocks: [file.blocks[0]] } },
    }) }));
  });

  it("discovers page resources on open and attaches selected text only after sending", async () => {
    render(<TooltipProvider><DocumentsPage embedded /></TooltipProvider>);
    await screen.findByRole("button", { name: "Research notes" });
    expect(requestPageResource).toHaveBeenCalledWith({ type: "scan" }, expect.any(AbortSignal));
    expect(port.postMessage).not.toHaveBeenCalled();
    expect(screen.getByRole("textbox")).toBeDisabled();
    vi.mocked(requestPageResource).mockResolvedValueOnce({ type: "bytes", format: "text", name: "notes.txt", base64: btoa("Revenue grew by 12 percent.") });
    fireEvent.click(screen.getByRole("button", { name: "Research notes" }));
    await screen.findByText("Revenue grew by 12 percent.");
    expect(requestPageResource).toHaveBeenLastCalledWith({ type: "read", resourceId: catalog.resources[0]!.id }, expect.any(AbortSignal));
    expect(port.postMessage).not.toHaveBeenCalled();
    const prompt = screen.getByRole("textbox");
    fireEvent.change(prompt, { target: { value: "Summarize" } });
    fireEvent.keyDown(prompt, { key: "Enter" });
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "run", request: expect.objectContaining({
      prompt: "Summarize", snapshot: { type: "file", file: expect.objectContaining({ name: "notes.txt", blocks: [expect.objectContaining({ text: "Revenue grew by 12 percent." })] }) },
    }) }));
    expect(screen.getByRole("textbox")).toBe(prompt);
  });

  it("filters images, previews their actual PNG and sends a vision snapshot", async () => {
    render(<TooltipProvider><DocumentsPage embedded /></TooltipProvider>);
    await screen.findByRole("tab", { name: "Images 1" });
    fireEvent.click(screen.getByRole("tab", { name: "Images 1" }));
    const image = { id: crypto.randomUUID(), name: "Revenue chart", dataUrl: `data:image/png;base64,${readFileSync("public/icon/32.png").toString("base64")}` };
    vi.mocked(requestPageResource).mockResolvedValueOnce({ type: "image", image });
    fireEvent.click(screen.getByRole("button", { name: "Revenue chart" }));
    expect(await screen.findByRole("img", { name: "Revenue chart" })).toHaveAttribute("src", image.dataUrl);
    expect(screen.queryByRole("switch", { name: "Web search" })).toBeNull();
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "Explain this chart" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ request: expect.objectContaining({ snapshot: { type: "image", image }, webSearch: false }) }));
    const sent = port.postMessage.mock.calls[0]![0];
    act(() => port.onMessage.addListener.mock.calls[0]![0]({ type: "result", requestId: sent.requestId, result: { ok: true, data: { content: "Chart answer" } } }));
    fireEvent.change(screen.getByRole("textbox"), { target: { value: "What changed?" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));
    expect(port.postMessage).toHaveBeenLastCalledWith(expect.objectContaining({ request: expect.objectContaining({
      snapshot: { type: "none" }, history: [expect.objectContaining({ role: "user", imageDataUrl: image.dataUrl }), { role: "assistant", content: "Chart answer" }],
    }) }));
  });

  it("keeps unsupported videos open-only and refreshes the resource list", async () => {
    render(<TooltipProvider><DocumentsPage embedded /></TooltipProvider>);
    await screen.findByRole("tab", { name: "Videos 1" });
    fireEvent.click(screen.getByRole("tab", { name: "Videos 1" }));
    expect(screen.getByRole("button", { name: "Recording" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "Open original" })).toHaveAttribute("href", "https://example.com/video.mp4");
    vi.mocked(requestPageResource).mockResolvedValueOnce({ ...catalog, resources: [] });
    fireEvent.click(screen.getByRole("button", { name: "Refresh resources" }));
    await screen.findByText("No resources found");
    expect(port.postMessage).not.toHaveBeenCalled();
  });

  it("keeps local file reading available when page discovery fails", async () => {
    vi.mocked(requestPageResource).mockRejectedValueOnce(new Error("resourceConnectionClosed"));
    render(<TooltipProvider><DocumentsPage embedded /></TooltipProvider>);
    expect(await screen.findByRole("alert")).toHaveTextContent("The page connection closed");
    fireEvent.change(screen.getByLabelText("Open local file", { selector: "input" }), { target: { files: [new File(["Local notes"], "local.txt", { type: "text/plain" })] } });
    await screen.findByText("Local notes");
    await waitFor(() => expect(screen.getByRole("textbox")).toBeEnabled());
    expect(port.postMessage).not.toHaveBeenCalled();
  });
});
