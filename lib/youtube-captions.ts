import { browser } from "wxt/browser";
import { z } from "zod";
import type { CommandResult } from "../shared/messages";
import { youtubeVideoId, type YouTubeCaptionSource } from "../shared/video";

const playerSchema = z.object({
  url: z.url(),
  videoId: z.string().regex(/^[\w-]{11}$/),
  title: z.string().min(1),
  clientName: z.string().min(1),
  tracks: z.array(z.object({ url: z.url(), languageCode: z.string().min(1) })).min(1),
});

// Chrome serializes injected functions; they must use only their arguments and page globals.
function inspectYouTubePlayer(videoId: string): CommandResult<unknown> {
  const url = new URL(location.href);
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) || url.pathname !== "/watch" || url.searchParams.get("v") !== videoId)
    return { ok: false, error: "youtubeVideoChanged" };
  const player = document.querySelector<Element & { getVideoData?: () => unknown; getAudioTrack?: () => unknown }>("#movie_player");
  if (typeof player?.getVideoData !== "function" || typeof player.getAudioTrack !== "function")
    return { ok: false, error: "youtubePlayerNotReady" };
  const video = player.getVideoData();
  if (!video || typeof video !== "object" || !("video_id" in video) || video.video_id !== videoId)
    return { ok: false, error: "youtubeVideoChanged" };
  const audio = player.getAudioTrack();
  if (!audio || typeof audio !== "object") return { ok: false, error: "youtubePlayerNotReady" };
  if (!("captionTracks" in audio))
    return { ok: false, error: "youtubeCaptionsUnavailable" };
  if (!Array.isArray(audio.captionTracks)) return { ok: false, error: "videoTranscriptInvalid" };
  if (audio.captionTracks.length === 0) return { ok: false, error: "youtubeCaptionsUnavailable" };
  const captionTracks: unknown[] = audio.captionTracks;
  const tracks = [];
  for (const track of captionTracks) {
    if (!track || typeof track !== "object" || !("url" in track) || !("languageCode" in track))
      return { ok: false, error: "videoTranscriptInvalid" };
    tracks.push({ url: track.url, languageCode: track.languageCode });
  }
  const config = (window as Window & { ytcfg?: { get?: (key: string) => unknown } }).ytcfg;
  if (typeof config?.get !== "function") return { ok: false, error: "youtubePlayerNotReady" };
  const clientName = config.get("INNERTUBE_CLIENT_NAME");
  if (typeof clientName !== "string" || !clientName.trim()) return { ok: false, error: "youtubePlayerNotReady" };
  return { ok: true, data: { url: url.href, videoId, title: "title" in video ? video.title : undefined, clientName, tracks } };
}

async function fetchYouTubeCaptions(videoId: string, address: string): Promise<CommandResult<string>> {
  const page = new URL(location.href);
  const url = new URL(address);
  if (page.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(page.hostname) || page.pathname !== "/watch" || page.searchParams.get("v") !== videoId)
    return { ok: false, error: "youtubeVideoChanged" };
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) || url.pathname !== "/api/timedtext" || url.searchParams.get("v") !== videoId || url.username || url.password)
    return { ok: false, error: "videoTranscriptInvalid" };
  const player = document.querySelector<Element & { getVideoData?: () => unknown }>("#movie_player");
  const videoElement = player?.querySelector("video");
  const isCurrentVideo = () => {
    const current = new URL(location.href);
    const data = player?.getVideoData?.();
    return current.origin === page.origin && current.pathname === "/watch" && current.searchParams.get("v") === videoId &&
      player?.isConnected && videoElement?.isConnected && player.querySelector("video") === videoElement &&
      data && typeof data === "object" && "video_id" in data && data.video_id === videoId;
  };
  if (!isCurrentVideo()) return { ok: false, error: "youtubeVideoChanged" };
  const controller = new AbortController();
  const navigated = () => controller.abort();
  const timeout = setTimeout(() => controller.abort(new Error("youtubeCaptionsTimeout")), 15_000);
  document.addEventListener("yt-navigate-start", navigated, { once: true });
  window.addEventListener("pagehide", navigated, { once: true });
  try {
    const response = await fetch(url.href, { credentials: "same-origin", redirect: "error", signal: controller.signal });
    if (!response.ok) return { ok: false, error: [401, 403, 429].includes(response.status) ? "youtubeCaptionsAccessDenied" : "youtubeCaptionsReadFailed" };
    if (!response.body) return { ok: false, error: "youtubeCaptionsEmpty" };
    const limit = 4 * 1024 * 1024;
    if (Number(response.headers.get("content-length")) > limit) {
      await response.body.cancel();
      return { ok: false, error: "youtubeCaptionsTooLarge" };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    let text = "";
    let bytes = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        bytes += value.length;
        if (bytes > limit) return { ok: false, error: "youtubeCaptionsTooLarge" };
        text += decoder.decode(value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      try { await reader.cancel(); }
      finally { reader.releaseLock(); }
    }
    if (!isCurrentVideo() || controller.signal.aborted) return { ok: false, error: "youtubeVideoChanged" };
    if (!text.trim()) return { ok: false, error: "youtubeCaptionsEmpty" };
    return { ok: true, data: text };
  } catch {
    return { ok: false, error: controller.signal.aborted
      ? controller.signal.reason instanceof Error && controller.signal.reason.message === "youtubeCaptionsTimeout" ? "youtubeCaptionsTimeout" : "youtubeVideoChanged"
      : "youtubeCaptionsReadFailed" };
  } finally {
    clearTimeout(timeout);
    document.removeEventListener("yt-navigate-start", navigated);
    window.removeEventListener("pagehide", navigated);
  }
}

export async function readYouTubeCaptions(tabId: number, videoId: string): Promise<YouTubeCaptionSource> {
  if (typeof videoId !== "string" || !/^[\w-]{11}$/.test(videoId)) throw new Error("youtubeVideoRequired");
  const inspected = await browser.scripting.executeScript({
    target: { tabId, frameIds: [0] }, world: "MAIN", func: inspectYouTubePlayer, args: [videoId],
  });
  const frame = inspected[0];
  if (inspected.length !== 1 || !frame || frame.frameId !== 0 || !frame.documentId || !frame.result)
    throw new Error("youtubePlayerNotReady");
  if (!frame.result.ok) throw new Error(frame.result.error);
  const parsed = playerSchema.safeParse(frame.result.data);
  if (!parsed.success) throw new Error("videoTranscriptInvalid");
  const player = parsed.data;
  if (player.videoId !== videoId || youtubeVideoId(player.url) !== videoId) throw new Error("youtubeVideoChanged");
  const track = player.tracks[0];
  if (!track) throw new Error("youtubeCaptionsUnavailable");
  const url = new URL(track.url, player.url);
  if (url.protocol !== "https:" || !["youtube.com", "www.youtube.com", "m.youtube.com"].includes(url.hostname) || url.pathname !== "/api/timedtext" || url.searchParams.get("v") !== videoId || url.username || url.password)
    throw new Error("videoTranscriptInvalid");
  // YouTube's player marks caption URLs requiring playback verification with xpe/xpv.
  const experiments = url.searchParams.get("exp");
  if ((experiments?.includes("xpe") || experiments?.includes("xpv")) && !url.searchParams.get("pot"))
    throw new Error("youtubeCaptionsNotReady");
  url.searchParams.set("fmt", "srv3");
  url.searchParams.set("c", player.clientName);
  const fetched = await browser.scripting.executeScript({
    target: { tabId, documentIds: [frame.documentId] }, world: "MAIN", func: fetchYouTubeCaptions, args: [videoId, url.href],
  });
  const response = fetched[0];
  if (fetched.length !== 1 || !response || response.documentId !== frame.documentId || !response.result)
    throw new Error("youtubeVideoChanged");
  if (!response.result.ok) throw new Error(response.result.error);
  return { videoId, url: player.url, title: player.title, languageCode: track.languageCode, xml: response.result.data };
}
