import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { readYouTubeCaptions } from "../lib/youtube-captions";

const scripting = vi.hoisted(() => ({ executeScript: vi.fn() }));
vi.mock("wxt/browser", () => ({ browser: { scripting } }));
const videoId = "abcdefghijk";
const xml = '<timedtext format="3"><body><p t="0">Direct subtitles</p></body></timedtext>';
const getVideoData = vi.fn();
const getAudioTrack = vi.fn();
const getConfig = vi.fn();
type ScriptRequest = { func: (...args: string[]) => unknown; args: string[]; target: { tabId: number; frameIds?: number[]; documentIds?: string[] }; world: string };

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("location", { href: `https://www.youtube.com/watch?v=${videoId}` });
  document.body.innerHTML = '<div id="movie_player"><video class="html5-main-video"></video></div>';
  const player = document.querySelector("#movie_player");
  if (!player) throw new Error("Missing player fixture");
  Object.assign(player, { getVideoData, getAudioTrack });
  getVideoData.mockReturnValue({ video_id: videoId, title: "Video title" });
  getConfig.mockImplementation((key: string) => key === "INNERTUBE_CLIENT_NAME" ? "WEB" : undefined);
  vi.stubGlobal("ytcfg", { get: getConfig });
  getAudioTrack.mockReturnValue({ captionTracks: [{
    url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&exp=xpe&potc=1&pot=runtime-token&signature=signed&fmt=json3`, languageCode: "en",
  }] });
  scripting.executeScript.mockImplementation(async (request: ScriptRequest) => [{ frameId: 0, documentId: "document-a", result: await request.func(...request.args) }]);
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(xml, { headers: { "content-type": "text/xml" } })));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("YouTube player subtitle transport", () => {
  it("uses runtime caption URLs in the current document without a transcript panel or extra permissions", async () => {
    const result = await readYouTubeCaptions(42, videoId);
    expect(result).toEqual({ videoId, url: `https://www.youtube.com/watch?v=${videoId}`, title: "Video title", languageCode: "en", xml });
    expect(scripting.executeScript).toHaveBeenNthCalledWith(1, expect.objectContaining({ target: { tabId: 42, frameIds: [0] }, world: "MAIN" }));
    expect(scripting.executeScript).toHaveBeenNthCalledWith(2, expect.objectContaining({ target: { tabId: 42, documentIds: ["document-a"] }, world: "MAIN" }));
    const address = vi.mocked(fetch).mock.calls[0]?.[0];
    if (typeof address !== "string") throw new Error("Missing caption request");
    const url = new URL(address);
    expect(url.pathname).toBe("/api/timedtext");
    expect(url.searchParams.get("pot")).toBe("runtime-token");
    expect(url.searchParams.get("signature")).toBe("signed");
    expect(url.searchParams.get("fmt")).toBe("srv3");
    expect(vi.mocked(fetch).mock.calls[0]?.[1]).toMatchObject({ credentials: "same-origin", redirect: "error" });
    expect(JSON.stringify(result)).not.toContain("runtime-token");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it.each(["WEB", "MWEB"])("sends the page client identity %s with its runtime token to avoid an empty 200 response", async (clientName) => {
    getConfig.mockReturnValue(clientName);
    vi.mocked(fetch).mockImplementation(async (address) => {
      const url = new URL(String(address));
      return new Response(url.searchParams.get("c") === clientName && url.searchParams.get("pot") === "runtime-token" ? xml : "");
    });
    await expect(readYouTubeCaptions(42, videoId)).resolves.toMatchObject({ xml });
    expect(getConfig).toHaveBeenCalledWith("INNERTUBE_CLIENT_NAME");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("does not guess the client identity when page configuration is not ready", async () => {
    getConfig.mockReturnValue(undefined);
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubePlayerNotReady");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each(["xpe", "xpv"])("does not download a %s subtitle track before the player adds its verification token", async (experiment) => {
    getAudioTrack.mockReturnValue({ captionTracks: [{
      url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en&exp=${experiment}`, languageCode: "en",
    }] });
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeCaptionsNotReady");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reads tracks that do not require playback verification without requiring a token", async () => {
    getAudioTrack.mockReturnValue({ captionTracks: [{
      url: `https://www.youtube.com/api/timedtext?v=${videoId}&lang=en`, languageCode: "en",
    }] });
    await expect(readYouTubeCaptions(42, videoId)).resolves.toMatchObject({ xml });
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects missing tracks, an uninitialized player and stale player metadata before downloading", async () => {
    getAudioTrack.mockReturnValueOnce({ captionTracks: [] }).mockReturnValueOnce(undefined);
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeCaptionsUnavailable");
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubePlayerNotReady");
    getVideoData.mockReturnValue({ video_id: "12345678901", title: "Other video" });
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeVideoChanged");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    { captionTracks: "invalid" },
    { captionTracks: [null] },
    { captionTracks: [{ url: "https://www.youtube.com/api/timedtext?v=abcdefghijk" }] },
  ])("reports malformed player caption metadata as invalid data", async (audio) => {
    getAudioTrack.mockReturnValue(audio);
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("videoTranscriptInvalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    `https://unrelated.example/api/timedtext?v=${videoId}`,
    `https://www.youtube.com/other?v=${videoId}`,
    "https://www.youtube.com/api/timedtext?v=12345678901",
    `https://user:secret@www.youtube.com/api/timedtext?v=${videoId}`,
  ])("rejects a caption URL outside the current video's endpoint: %s", async (url) => {
    getAudioTrack.mockReturnValue({ captionTracks: [{ url, languageCode: "en" }] });
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("videoTranscriptInvalid");
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([401, 403, 429])("reports access restrictions (%s) without retrying another endpoint", async (status) => {
    vi.mocked(fetch).mockResolvedValue(new Response("Denied", { status }));
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeCaptionsAccessDenied");
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("rejects empty content and stops oversized downloads", async () => {
    vi.mocked(fetch).mockResolvedValueOnce(new Response(""))
      .mockResolvedValueOnce(new Response("large", { headers: { "content-length": String(4 * 1024 * 1024 + 1) } }))
      .mockResolvedValueOnce(new Response(new Uint8Array(4 * 1024 * 1024 + 1)));
    for (const error of ["youtubeCaptionsEmpty", "youtubeCaptionsTooLarge", "youtubeCaptionsTooLarge"]) {
      await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow(error);
    }
  });

  it("discards downloaded data when the video changes", async () => {
    vi.mocked(fetch).mockImplementation(async () => {
      getVideoData.mockReturnValue({ video_id: "12345678901", title: "Next video" });
      return new Response(xml);
    });
    await expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeVideoChanged");
  });

  it("aborts an in-progress subtitle request on YouTube navigation", async () => {
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    }));
    const pending = readYouTubeCaptions(42, videoId);
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledOnce());
    document.dispatchEvent(new Event("yt-navigate-start"));
    await expect(pending).rejects.toThrow("youtubeVideoChanged");
    expect(vi.mocked(fetch).mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });

  it("times out a stalled download", async () => {
    vi.useFakeTimers();
    vi.mocked(fetch).mockImplementation((_url, options) => new Promise((_resolve, reject) => {
      options?.signal?.addEventListener("abort", () => reject(options.signal?.reason));
    }));
    const assertion = expect(readYouTubeCaptions(42, videoId)).rejects.toThrow("youtubeCaptionsTimeout");
    await vi.advanceTimersByTimeAsync(15_000);
    await assertion;
  });
});
