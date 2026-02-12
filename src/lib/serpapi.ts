import type { VideoSearchResult } from "./types";

interface SerpApiResponse {
  transcript?: { snippet: string }[];
  error?: string;
}

interface SerpApiYouTubeVideoItem {
  link?: string;
  title?: string;
  channel?: { name?: string; thumbnail?: string };
  thumbnail?: string | { static?: string };
  /** Total view count for the video when available */
  views?: number;
  /** Duration string, e.g. "9:28" or "1:02:15" */
  length?: string;
}

interface SerpApiYouTubeSearchResponse {
  video_results?: SerpApiYouTubeVideoItem[];
  ads_results?: SerpApiYouTubeVideoItem[];
  error?: string;
}

const VIDEO_ID_REGEX = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function parseDurationSeconds(length: string | undefined): number {
  if (!length) return 0;
  const parts = length.split(":").map(Number);
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  return parts[0] || 0;
}

function extractVideoIdFromLink(link: string): string | null {
  const match = link.match(VIDEO_ID_REGEX);
  return match?.[1] ?? null;
}

function parseVideoResult(item: SerpApiYouTubeVideoItem): VideoSearchResult | null {
  const link = item.link;
  if (!link) return null;
  const videoId = extractVideoIdFromLink(link);
  if (!videoId) return null;

  // Filter out Shorts / very short videos (< 3 minutes)
  const durationSec = parseDurationSeconds(item.length);
  if (durationSec > 0 && durationSec < 180) return null;

  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return {
    videoId,
    title: item.title ?? "Untitled",
    channelName: item.channel?.name ?? "",
    channelThumbnail: item.channel?.thumbnail || undefined,
    thumbnail,
    url: link,
    viewCount: typeof item.views === "number" ? item.views : undefined,
  };
}

export async function searchRecipeVideos(query: string): Promise<VideoSearchResult[]> {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("SERPAPI_KEY not configured");
  }

  const searchQuery = `${query.trim()} recipe`;
  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "youtube");
  url.searchParams.set("search_query", searchQuery);
  url.searchParams.set("sp", "EgIoAQ%3D%3D"); // YouTube "Subtitles/CC" feature filter
  url.searchParams.set("api_key", apiKey);

  console.log("[SerpApi] Searching for:", searchQuery);
  console.log("[SerpApi] Using API key:", apiKey.slice(0, 8) + "...");

  const response = await fetch(url.toString());

  console.log("[SerpApi] Response status:", response.status);

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      const text = await response.text();
      console.error("[SerpApi] Search error (raw):", response.status, text);
    }
    const serpError = (body.error as string) || `HTTP ${response.status}`;
    console.error("[SerpApi] Search error:", response.status, serpError);

    if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    throw new Error(`SerpApi error: ${serpError}`);
  }

  const data: SerpApiYouTubeSearchResponse = await response.json();

  if (data.error) {
    console.error("SerpApi returned error:", data.error);
    throw new Error(`SerpApi error: ${data.error}`);
  }

  const results: VideoSearchResult[] = [];
  const seen = new Set<string>();

  const processItems = (items: SerpApiYouTubeSearchResponse["video_results"] = []) => {
    for (const item of items) {
      const parsed = parseVideoResult(item);
      if (parsed && !seen.has(parsed.videoId)) {
        seen.add(parsed.videoId);
        results.push(parsed);
        if (results.length >= 8) return;
      }
    }
  };

  processItems(data.video_results);
  processItems(data.ads_results);

  return results.slice(0, 8);
}

export async function fetchTranscript(videoId: string): Promise<string> {
  const apiKey = process.env.SERPAPI_KEY;

  if (!apiKey) {
    throw new Error("SERPAPI_KEY not configured");
  }

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "youtube_video_transcript");
  url.searchParams.set("v", videoId);
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      const text = await response.text();
      console.error("SerpApi error:", response.status, text);
    }
    const serpError = (body.error as string) || `HTTP ${response.status}`;
    console.error("SerpApi error:", response.status, serpError);

    if (response.status === 429) {
      throw new Error("Rate limit exceeded");
    }
    throw new Error(`SerpApi error: ${serpError}`);
  }

  const data: SerpApiResponse = await response.json();

  if (data.error) {
    console.error("SerpApi returned error:", data.error);
    throw new Error(`SerpApi error: ${data.error}`);
  }

  if (!data.transcript || data.transcript.length === 0) {
    throw new Error("No transcript available for this video");
  }

  return data.transcript
    .map((segment) => segment.snippet)
    .join(" ")
    .trim();
}
