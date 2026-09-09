import { Blob as NodeBlob, File as NodeFile } from "node:buffer";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { browser } from "wxt/browser";
import { PageResources } from "../lib/page-resources";
import { decodeResourceFile } from "../shared/page-resources";
import { readTextFile, TEXT_FILE_BYTE_LIMIT } from "../shared/files";
import { normalizeImageBlob } from "../shared/image";

vi.mock("../shared/image", async (original) => ({
  ...await original<typeof import("../shared/image")>(), normalizeImageBlob: vi.fn(),
}));

let resources: PageResources;
beforeEach(() => {
  document.body.innerHTML = "";
  document.head.innerHTML = "<title>Resource page</title>";
  vi.stubGlobal("fetch", vi.fn());
  vi.stubGlobal("Blob", NodeBlob);
  vi.stubGlobal("File", NodeFile);
  resources = new PageResources();
});
afterEach(() => {
  resources.destroy();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("page resource discovery", () => {
  it("classifies and deduplicates page resources without downloading them", () => {
    document.body.innerHTML = `
      <a href="/report.pdf#page=1">Annual report</a><embed src="/report.pdf#page=2" type="application/pdf">
      <a href="/download?id=1" type="text/markdown; charset=utf-8" download="notes.md">Notes</a>
      <a href="/slides.pptx">Slides</a>
      <a href="/photo.jpg">Photo</a><img src="/photo.jpg" alt="Photo">
      <video src="/movie.mp4"></video><a href="/movie.mp4">Movie</a>
      <iframe src="https://www.youtube.com/embed/abcdefghijk"></iframe>
      <a href="/other">Ordinary link</a><iframe src="/other"></iframe>
      <div data-hyperpage-ui><a href="/private.txt">Extension UI</a></div>`;
    const catalog = resources.scan();
    expect(catalog.resources.map(({ kind, reader }) => [kind, reader])).toEqual([
      ["document", "pdf"], ["document", "text"], ["document", null],
      ["image", "image"], ["video", null], ["video", null],
    ]);
    expect(catalog.resources[0]?.name).toBe("Annual report");
    expect(catalog.resources[1]?.format).toBe("md");
    expect(fetch).not.toHaveBeenCalled();
    expect(resources.scan().resources.map(({ id }) => id)).toEqual(catalog.resources.map(({ id }) => id));
  });

  it("uses the displayed image source and excludes unsafe, empty and malformed addresses", () => {
    document.body.innerHTML = `<img src="/small.png"><img src=""><img>
      <img src="javascript:alert(1)"><img src="http://[invalid">
      <a href="javascript:alert(1)" download="bad.pdf">Unsafe</a>
      <a href="file:///private.pdf">Local</a><img src="data:image/png;base64,AAAA">`;
    Object.defineProperty(document.querySelector("img"), "currentSrc", { value: "https://cdn.example/large.png" });
    const catalog = resources.scan();
    expect(catalog.resources).toHaveLength(2);
    expect(catalog.resources[0]?.url).toBe("https://cdn.example/large.png");
    expect(catalog.resources[1]).toMatchObject({ name: "Resource page", url: null });
  });

  it("rejects removed or replaced resources and resolves relative URLs at scan time", async () => {
    document.body.innerHTML = '<a href="/report.pdf">Report</a>';
    const item = resources.scan().resources[0]!;
    document.querySelector("a")!.setAttribute("href", "/other.pdf");
    await expect(resources.execute({ type: "read", resourceId: item.id })).rejects.toThrow("resourceUnavailable");
    const replacement = resources.scan().resources[0]!;
    document.querySelector("a")!.remove();
    await expect(resources.execute({ type: "reveal", resourceId: replacement.id })).rejects.toThrow("resourceUnavailable");
    expect(resources.scan().resources).toEqual([]);
    expect(fetch).not.toHaveBeenCalled();
  });
});

describe("page resource reading", () => {
  it("discovers YouTube with CC off and directly reads timestamped subtitles on selection", async () => {
    const videoId = "abcdefghijk";
    const url = `https://www.youtube.com/watch?v=${videoId}`;
    vi.stubGlobal("location", { href: url });
    document.body.innerHTML = '<video class="html5-main-video"></video><button class="ytp-subtitles-button" aria-pressed="false">CC</button>';
    const video = document.querySelector("video");
    if (!video) throw new Error("Missing video fixture");
    Object.defineProperty(video, "duration", { value: 100 });
    video.scrollIntoView = vi.fn();
    const sendMessage = vi.spyOn(browser.runtime, "sendMessage").mockImplementation(async () => ({ ok: true, data: {
      videoId, url, title: "Lecture", languageCode: "en",
      xml: '<timedtext format="3"><body><p t="2000">First</p><p t="12000">Second</p></body></timedtext>',
    } }));
    const item = resources.scan().resources[0];
    expect(item).toMatchObject({ kind: "video", url, reader: "youtube" });
    expect(sendMessage).not.toHaveBeenCalled();
    if (!item) throw new Error("Missing discovered video");
    const result = await resources.execute({ type: "read", resourceId: item.id });
    if (result.type !== "page") throw new Error("Expected timestamped page snapshot");
    expect(sendMessage).toHaveBeenCalledWith({ target: "background", type: "read-youtube-captions", videoId });
    expect(result.page.blocks.map(({ text, timeSeconds }) => [text, timeSeconds])).toEqual([["First", 2], ["Second", 12]]);
    expect(await resources.execute({ type: "locate", snapshotId: result.page.id, blockId: "1.2" })).toEqual({ type: "located", found: true });
    expect(video.currentTime).toBe(12);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads text bytes through the existing text parser, retaining paragraphs", async () => {
    document.body.innerHTML = '<a href="/notes.txt">Notes</a>';
    const item = resources.scan().resources[0]!;
    vi.mocked(fetch).mockResolvedValue(new Response("First paragraph\n\nSecond paragraph", { headers: { "content-type": "text/plain; charset=utf-8" } }));
    const result = await resources.execute({ type: "read", resourceId: item.id });
    expect(result.type).toBe("bytes");
    if (result.type !== "bytes") throw new Error("Expected file bytes");
    expect((await readTextFile(decodeResourceFile(result))).blocks.map(({ text }) => text)).toEqual(["First paragraph", "Second paragraph"]);
    expect(fetch).toHaveBeenCalledWith(new URL("/notes.txt", location.href).href, expect.objectContaining({ credentials: "same-origin", signal: expect.any(AbortSignal) }));
  });

  it("preserves a MIME-identified PDF format despite a misleading link label", async () => {
    document.body.innerHTML = '<a href="/download" type="application/pdf">notes.txt</a>';
    vi.mocked(fetch).mockResolvedValue(new Response("%PDF-1.7", { headers: { "content-type": "application/pdf" } }));
    const item = resources.scan().resources[0]!;
    const result = await resources.execute({ type: "read", resourceId: item.id });
    expect(result).toMatchObject({ type: "bytes", format: "pdf", name: "notes.txt.pdf" });
  });

  it("passes fetched image bytes to normalization and never captures the page", async () => {
    document.body.innerHTML = '<img src="/chart.jpg" alt="Chart">';
    vi.mocked(fetch).mockResolvedValue(new Response("image", { headers: { "content-type": "image/jpeg" } }));
    vi.mocked(normalizeImageBlob).mockResolvedValue("data:image/png;base64,normalized");
    const item = resources.scan().resources[0]!;
    expect(await resources.execute({ type: "read", resourceId: item.id })).toMatchObject({ type: "image", image: { name: "Chart", dataUrl: "data:image/png;base64,normalized" } });
    expect(normalizeImageBlob).toHaveBeenCalledWith(expect.objectContaining({ type: "image/jpeg", size: 5 }));
  });

  it("rejects unsupported files, HTML login pages, failed fetches and oversized streams", async () => {
    document.body.innerHTML = '<a href="/doc.docx">Office</a><a href="/notes.txt">Notes</a>';
    const [office, notes] = resources.scan().resources;
    await expect(resources.execute({ type: "read", resourceId: office!.id })).rejects.toThrow("resourceUnsupported");
    expect(fetch).not.toHaveBeenCalled();
    vi.mocked(fetch).mockResolvedValueOnce(new Response("<html>Login</html>", { headers: { "content-type": "text/html" } }))
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(new Response("x", { headers: { "content-length": String(TEXT_FILE_BYTE_LIMIT + 1) } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(TEXT_FILE_BYTE_LIMIT + 1)));
    for (const error of ["resourceContentInvalid", "resourceReadFailed", "resourceTooLarge", "resourceTooLarge"]) {
      await expect(resources.execute({ type: "read", resourceId: notes!.id })).rejects.toThrow(error);
    }
  });

  it("aborts resource downloads when the page controller is destroyed", async () => {
    document.body.innerHTML = '<a href="/notes.txt">Notes</a>';
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options!.signal!.addEventListener("abort", () => reject(options!.signal!.reason));
    }));
    const pending = resources.execute({ type: "read", resourceId: resources.scan().resources[0]!.id });
    resources.destroy();
    await expect(pending).rejects.toThrow();
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("reads loaded native subtitles and seeks citations only while their video remains available", async () => {
    class Cue { constructor(public startTime: number, public endTime: number, public text: string) {} }
    vi.stubGlobal("VTTCue", Cue);
    document.body.innerHTML = '<video src="blob:http://localhost/movie" title="Lecture"></video>';
    const video = document.querySelector("video")!;
    Object.defineProperty(video, "textTracks", { value: [{ kind: "subtitles", cues: [new Cue(2, 5, "First"), new Cue(12, 16, "Second")] }] });
    video.scrollIntoView = vi.fn();
    const item = resources.scan().resources[0]!;
    expect(item).toMatchObject({ kind: "video", url: null, reader: "transcript" });
    const result = await resources.execute({ type: "read", resourceId: item.id });
    if (result.type !== "file") throw new Error("Expected subtitles");
    expect(result.file.blocks.map(({ text, heading }) => [text, heading])).toEqual([["First", "0:02"], ["Second", "0:12"]]);
    const command = { type: "locate" as const, snapshotId: result.file.id, blockId: "1.2" };
    expect(await resources.execute(command)).toEqual({ type: "located", found: true });
    expect(video.currentTime).toBe(12);
    video.remove();
    expect(await resources.execute(command)).toEqual({ type: "located", found: false });
    expect(await resources.execute({ ...command, snapshotId: "unknown" })).toEqual({ type: "located", found: false });
    expect(fetch).not.toHaveBeenCalled();
  });
});
