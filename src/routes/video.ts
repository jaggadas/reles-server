import { Router } from "express";
import { searchRecipeVideos, fetchTranscript } from "../lib/serpapi";
import { getVideoDetails } from "../lib/composio";
import { getRecipeExtractor } from "../lib/llm-providers";
import { getCachedRecipe, cacheRecipe } from "../lib/firestore-cache";
import type { ExtractionOutput } from "../lib/llm-providers/types";

const router = Router();

function buildResult(
  details: { title: string; channelTitle: string },
  output: ExtractionOutput
) {
  return {
    title: details.title || "Untitled Recipe",
    videoTitle: details.title,
    channelTitle: details.channelTitle,
    ingredients: output.ingredients,
    instructions: output.instructions,
    servings: output.servings,
    prepTimeMinutes: output.prep_time_minutes,
    cookTimeMinutes: output.cook_time_minutes,
    allergens: output.allergens,
    caloriesKcal: output.calories_kcal,
    difficulty: output.difficulty,
    cuisine: output.cuisine,
    accompanyingRecipes: output.accompanying_recipes,
    highlights: output.highlights ?? [],
  };
}

// GET /api/video/search?q=
router.get("/search", async (req, res) => {
  const q = (req.query.q as string)?.trim();

  if (!q) {
    res.status(400).json({ error: "Query parameter 'q' is required" });
    return;
  }

  try {
    const results = await searchRecipeVideos(q);
    res.json({ results });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to search videos";

    if (message.includes("not configured")) {
      res.status(500).json({ error: "Search service not configured" });
      return;
    }
    if (message.includes("Rate limit")) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }

    console.error("Video search error:", error);
    res.status(500).json({ error: "Failed to search videos" });
  }
});

// GET /api/video/:videoId/details
router.get("/:videoId/details", async (req, res) => {
  const { videoId } = req.params;

  try {
    const details = await getVideoDetails(videoId);
    res.json(details);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch video details";
    res.status(500).json({ detail: message });
  }
});

// GET /api/video/:videoId/transcript
router.get("/:videoId/transcript", async (req, res) => {
  const { videoId } = req.params;

  if (!videoId) {
    res.status(400).json({ error: "Video ID is required" });
    return;
  }

  try {
    const transcript = await fetchTranscript(videoId);
    res.set("Cache-Control", "public, max-age=86400");
    res.json({ transcript });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to fetch transcript";

    if (message.includes("not configured") || message.includes("Invalid")) {
      res.status(500).json({ error: "Transcript service not configured" });
      return;
    }
    if (message.includes("Rate limit")) {
      res.status(429).json({ error: "Rate limit exceeded" });
      return;
    }
    if (message.includes("No transcript")) {
      res.status(404).json({ error: "No transcript available for this video" });
      return;
    }

    console.error("Transcript fetch error:", error);
    res.status(500).json({ error: "Failed to fetch transcript" });
  }
});

// GET /api/video/:videoId/extract-stream (SSE)
router.get("/:videoId/extract-stream", async (req, res) => {
  const { videoId } = req.params;

  // SSE headers
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  const send = (event: string, data: unknown) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    // Check cache first
    const cached = await getCachedRecipe(videoId);
    if (cached) {
      send("complete", cached);
      res.end();
      return;
    }

    send("phase", { phase: "fetching" });

    const t0 = Date.now();

    // Fetch video details and transcript in parallel
    // Don't await details yet — start LLM as soon as transcript is ready
    const detailsPromise = getVideoDetails(videoId);

    let transcript: string;
    try {
      transcript = await fetchTranscript(videoId);
      console.log(`[stream ${videoId}] transcript fetched in ${Date.now() - t0}ms (${transcript.length} chars)`);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch transcript";
      if (message.includes("No transcript")) {
        send("error", { message: "This video does not have captions available." });
      } else if (message.includes("Rate limit")) {
        send("error", { message: "Rate limit exceeded. Please try again later." });
      } else {
        send("error", { message: `Failed to fetch transcript: ${message}` });
      }
      res.end();
      return;
    }

    send("phase", { phase: "extracting" });
    const t1 = Date.now();

    const extractor = getRecipeExtractor();

    if (!extractor.extractRecipeFromTranscriptStream) {
      // Fallback to non-streaming
      const output = await extractor.extractRecipeFromTranscript(transcript);
      const details = await detailsPromise;
      const result = buildResult(details, output);
      cacheRecipe(videoId, result).catch((err) =>
        console.error("Failed to cache recipe:", err)
      );
      send("complete", result);
      res.end();
      return;
    }

    const output = await extractor.extractRecipeFromTranscriptStream(
      transcript,
      (event) => {
        if (event.type === "complete") return; // we send our own complete
        send(event.type, event.data);
      }
    );

    console.log(`[stream ${videoId}] LLM streaming done in ${Date.now() - t1}ms`);

    // Details should be long resolved by now since LLM takes much longer
    const details = await detailsPromise;
    const result = buildResult(details, output);
    cacheRecipe(videoId, result).catch((err) =>
      console.error("Failed to cache recipe:", err)
    );
    send("complete", result);
    res.end();
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract recipe";
    send("error", { message });
    res.end();
  }
});

// GET /api/video/:videoId/extract
router.get("/:videoId/extract", async (req, res) => {
  const { videoId } = req.params;

  try {
    // Check Firestore cache first
    const cached = await getCachedRecipe(videoId);
    if (cached) {
      res.json(cached);
      return;
    }

    const details = await getVideoDetails(videoId);

    // Step 1: Fetch transcript from SerpApi
    let transcript: string;
    try {
      transcript = await fetchTranscript(videoId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to fetch transcript";
      if (message.includes("No transcript")) {
        res.status(404).json({ detail: "This video does not have captions available." });
        return;
      }
      if (message.includes("Rate limit")) {
        res.status(429).json({ detail: "Rate limit exceeded. Please try again later." });
        return;
      }
      res.status(500).json({ detail: `Failed to fetch transcript: ${message}` });
      return;
    }

    // Step 2: Extract recipe using configured LLM provider
    const extractor = getRecipeExtractor();
    const output = await extractor.extractRecipeFromTranscript(transcript);

    if (!Array.isArray(output.ingredients) || output.ingredients.length === 0) {
      res.status(400).json({ detail: "No ingredients could be extracted from this video." });
      return;
    }

    const result = buildResult(details, output);

    // Cache in Firestore for future dedup
    cacheRecipe(videoId, result).catch((err) =>
      console.error("Failed to cache recipe:", err)
    );

    res.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract recipe";
    res.status(500).json({ detail: message });
  }
});

export default router;
