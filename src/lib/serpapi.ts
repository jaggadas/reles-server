import type { VideoSearchResult } from "./types";

interface SerpApiResponse {
  transcript?: { snippet: string }[];
  error?: string;
}

interface SerpApiYouTubeSearchResponse {
  video_results?: Array<{
    link?: string;
    title?: string;
    channel?: { name?: string };
    thumbnail?: string | { static?: string };
  }>;
  ads_results?: Array<{
    link?: string;
    title?: string;
    channel?: { name?: string };
    thumbnail?: string | { static?: string };
  }>;
  error?: string;
}

const VIDEO_ID_REGEX = /(?:youtube\.com\/watch\?.*v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/;

function extractVideoIdFromLink(link: string): string | null {
  const match = link.match(VIDEO_ID_REGEX);
  return match?.[1] ?? null;
}

function parseVideoResult(
  item: { link?: string; title?: string; channel?: { name?: string }; thumbnail?: string | { static?: string } }
): VideoSearchResult | null {
  const link = item.link;
  if (!link) return null;
  const videoId = extractVideoIdFromLink(link);
  if (!videoId) return null;
  const thumbnail = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
  return {
    videoId,
    title: item.title ?? "Untitled",
    channelName: item.channel?.name ?? "",
    thumbnail,
    url: link,
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
  url.searchParams.set("api_key", apiKey);

  const response = await fetch(url.toString());

  if (!response.ok) {
    let body: Record<string, unknown> = {};
    try {
      body = await response.json();
    } catch {
      const text = await response.text();
      console.error("SerpApi search error:", response.status, text);
    }
    const serpError = (body.error as string) || `HTTP ${response.status}`;
    console.error("SerpApi search error:", response.status, serpError);

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
