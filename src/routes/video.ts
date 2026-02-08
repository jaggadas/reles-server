import { Router } from "express";
import { searchRecipeVideos, fetchTranscript } from "../lib/serpapi";
import { getVideoDetails } from "../lib/composio";
import { getRecipeExtractor } from "../lib/llm-providers";

const router = Router();

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

// GET /api/video/:videoId/extract
router.get("/:videoId/extract", async (req, res) => {
  const { videoId } = req.params;

  try {
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

    const recipeTitle = details.title || "Untitled Recipe";
    const ingredients = output.ingredients;
    const instructions = output.instructions;
    const servings = output.servings;
    const prepTimeMinutes = output.prep_time_minutes;
    const cookTimeMinutes = output.cook_time_minutes;
    const allergens = output.allergens;
    const caloriesKcal = output.calories_kcal;
    const difficulty = output.difficulty;
    const cuisine = output.cuisine;
    const accompanyingRecipes = output.accompanying_recipes;

    if (!Array.isArray(ingredients) || ingredients.length === 0) {
      res.status(400).json({ detail: "No ingredients could be extracted from this video." });
      return;
    }

    res.json({
      title: recipeTitle,
      videoTitle: details.title,
      ingredients,
      instructions,
      servings,
      prepTimeMinutes,
      cookTimeMinutes,
      allergens,
      caloriesKcal,
      difficulty,
      cuisine,
      accompanyingRecipes,
    });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to extract recipe";
    res.status(500).json({ detail: message });
  }
});

export default router;
