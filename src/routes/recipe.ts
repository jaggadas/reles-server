import { Router } from "express";
import { getComposioClient } from "../lib/composio";
import {
  incrementTimesMade,
  getPopularRecipes,
  getRecipesByCuisine,
  getQuickRecipes,
  getChallengeRecipes,
  getRecipesByCuisineDetailed,
  getPopularFeedRecipes,
} from "../lib/firestore-cache";
import { searchRecipeVideos } from "../lib/serpapi";
import type { VideoSearchResult } from "../lib/types";

interface IngredientInput {
  name: string;
  quantity?: string;
}

interface InstacartRequestBody {
  title: string;
  ingredients: IngredientInput[];
  instructions?: string[];
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  thumbnailUrl?: string;
  sourceUrl?: string;
}

function parseQuantity(
  str: string
): { quantity: number; unit: string } | null {
  const match = str.match(/^([\d./]+)\s*(.*)$/);
  if (!match) return null;

  let quantity: number;
  const raw = match[1];

  if (raw.includes("/")) {
    const [num, denom] = raw.split("/").map(Number);
    quantity = num / denom;
  } else {
    quantity = parseFloat(raw);
  }

  if (isNaN(quantity)) return null;

  let unit = match[2].trim().toLowerCase();

  const unitMap: Record<string, string> = {
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilogram: "kg",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    cup: "cup",
    cups: "cup",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    ml: "ml",
    l: "L",
    liter: "L",
    liters: "L",
  };

  unit = unitMap[unit] || unit || "each";

  return { quantity, unit };
}

const router = Router();

// POST /api/recipe/instacart
router.post("/instacart", async (req, res) => {
  try {
    const body: InstacartRequestBody = req.body;

    if (!body.title || !body.ingredients?.length) {
      res.status(400).json({ error: "Title and ingredients are required" });
      return;
    }

    const composio = getComposioClient();

    const ingredients = body.ingredients.map((ing) => {
      const result: {
        name: string;
        display_text?: string;
        quantity?: number;
        unit?: string;
      } = {
        name: ing.name,
      };

      if (ing.quantity) {
        result.display_text = `${ing.quantity} ${ing.name}`;
        const parsed = parseQuantity(ing.quantity);
        if (parsed) {
          result.quantity = parsed.quantity;
          result.unit = parsed.unit;
        }
      }

      return result;
    });

    const cookingTime =
      (body.prepTimeMinutes || 0) + (body.cookTimeMinutes || 0);

    const args: Record<string, unknown> = {
      title: body.title,
      ingredients,
      instructions: body.instructions || [],
    };

    if (body.servings) args.servings = body.servings;
    if (cookingTime > 0) args.cooking_time = cookingTime;
    if (body.thumbnailUrl) args.image_url = body.thumbnailUrl;
    args.expires_in = 30;
    if (body.sourceUrl) {
      args.landing_page_configuration = {
        partner_linkback_url: body.sourceUrl,
      };
    }

    const result = await composio.tools.execute("INSTACART_CREATE_RECIPE_PAGE", {
      custom_auth_params: {
        base_url: "https://connect.dev.instacart.tools",
        parameters: [],
      },
      arguments: args,
    });

    console.log(
      "Instacart recipe response:",
      JSON.stringify(result, null, 2)
    );

    const data = result.data as Record<string, unknown>;
    const url =
      (data?.url as string) ??
      (data?.products_link_url as string) ??
      (data?.data as Record<string, unknown>)?.url;

    if (!url || typeof url !== "string") {
      console.error("Instacart recipe response missing URL:", {
        fullResponse: result,
        data,
      });
      res.status(500).json({ error: "Instacart did not return a URL" });
      return;
    }

    res.json({ url });
  } catch (error) {
    console.error("Instacart recipe API error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
    });

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create Instacart link";

    if (message.includes("COMPOSIO_API_KEY")) {
      res.status(500).json({ error: "Instacart integration not configured" });
      return;
    }

    res.status(500).json({ error: "Failed to create Instacart link" });
  }
});

// POST /api/recipe/:videoId/made
router.post("/:videoId/made", async (req, res) => {
  const { videoId } = req.params;

  try {
    const timesMade = await incrementTimesMade(videoId);
    res.json({ timesMade });
  } catch (error) {
    console.error("Increment times made error:", error);
    res.status(500).json({ error: "Failed to update recipe" });
  }
});

// GET /api/recipe/popular
router.get("/popular", async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 10, 50);
  try {
    const recipes = await getPopularRecipes(limit);
    res.json({ recipes });
  } catch (error) {
    console.error("Get popular recipes error:", error);
    res.status(500).json({ error: "Failed to fetch popular recipes" });
  }
});

// ── Feed endpoint ───────────────────────────────────────────

// Simple in-memory cache for YouTube search results (30-min TTL)
const searchCache = new Map<string, { data: VideoSearchResult[]; expiresAt: number }>();
const SEARCH_CACHE_TTL = 30 * 60 * 1000;

function getCachedSearch(key: string): VideoSearchResult[] | null {
  const entry = searchCache.get(key);
  if (!entry || Date.now() > entry.expiresAt) {
    searchCache.delete(key);
    return null;
  }
  return entry.data;
}

function setCachedSearch(key: string, data: VideoSearchResult[]): void {
  searchCache.set(key, { data, expiresAt: Date.now() + SEARCH_CACHE_TTL });
}

function buildPickedForYouQueries(
  cuisines: string[],
  dietary: string,
  maxQueries: number
): string[] {
  const dietPrefix =
    dietary === "vegan" ? "vegan" : dietary === "vegetarian" ? "vegetarian" : "";
  const queries: string[] = [];

  const shuffled = [...cuisines].sort(() => Math.random() - 0.5);
  for (let i = 0; i < Math.min(maxQueries, shuffled.length); i++) {
    const cuisineName = shuffled[i].toLowerCase().replace(/_/g, " ");
    queries.push(`${dietPrefix} ${cuisineName}`.trim());
  }

  // Fallback if no cuisines selected
  if (queries.length === 0) {
    queries.push(`${dietPrefix} easy dinner`.trim());
  }

  return queries;
}

// GET /api/recipe/feed
router.get("/feed", async (req, res) => {
  try {
    const cuisinesParam = (req.query.cuisines as string) || "";
    const dietary = (req.query.dietary as string) || "none";
    const allergensParam = (req.query.allergens as string) || "";

    const cuisines = cuisinesParam ? cuisinesParam.split(",").filter(Boolean).map((c) => c.toUpperCase()) : [];
    const allergens = allergensParam
      ? allergensParam.split(",").map((a) => a.toLowerCase().trim()).filter(Boolean)
      : [];

    // Pick random cuisines for trending and deep dive sections
    const shuffledCuisines = [...cuisines].sort(() => Math.random() - 0.5);
    const trendingCuisine = shuffledCuisines[0] || null;
    const deepDiveCuisine = shuffledCuisines[1] || shuffledCuisines[0] || null;

    // Run Firestore queries in parallel
    let [trendingRecipes, quickTonightRecipes, deepDiveRecipes, challengeRecipes] =
      await Promise.all([
        trendingCuisine ? getRecipesByCuisine(trendingCuisine, 4) : Promise.resolve([]),
        getQuickRecipes(allergens, 6),
        deepDiveCuisine
          ? getRecipesByCuisineDetailed(deepDiveCuisine, 4)
          : Promise.resolve([]),
        getChallengeRecipes(cuisines, 4),
      ]);

    // Fallback: if cuisine-specific sections are empty, populate from popular recipes
    // so the homepage isn't barren for users with sparse cache data
    let effectiveTrendingCuisine = trendingCuisine;
    let effectiveDeepDiveCuisine = deepDiveCuisine;

    if (
      trendingRecipes.length === 0 &&
      quickTonightRecipes.length === 0 &&
      deepDiveRecipes.length === 0
    ) {
      const popular = await getPopularFeedRecipes(8);
      if (popular.length > 0) {
        // Use popular recipes for Quick Tonight (most universally useful)
        quickTonightRecipes = popular.slice(0, 6);

        // Group remaining by cuisine for trending/deep dive
        const cuisineSet = new Set(cuisines);
        const byCuisine = new Map<string, typeof popular>();
        for (const r of popular) {
          if (r.cuisine === "OTHER") continue;
          // Only use cuisines the user has selected (if they have preferences)
          if (cuisineSet.size > 0 && !cuisineSet.has(r.cuisine)) continue;
          const existing = byCuisine.get(r.cuisine) || [];
          existing.push(r);
          byCuisine.set(r.cuisine, existing);
        }

        // Pick the most common cuisine for trending
        const sorted = [...byCuisine.entries()].sort(
          (a, b) => b[1].length - a[1].length
        );
        if (sorted.length > 0) {
          effectiveTrendingCuisine = sorted[0][0];
          trendingRecipes = sorted[0][1].slice(0, 4);
        }
        if (sorted.length > 1) {
          effectiveDeepDiveCuisine = sorted[1][0];
          deepDiveRecipes = sorted[1][1].slice(0, 4);
        }
      }
    }

    // YouTube searches for "Picked For You" — run sequentially to respect rate limits
    const pickedForYouQueries = buildPickedForYouQueries(cuisines, dietary, 2);
    const pickedForYouVideos: VideoSearchResult[] = [];

    for (const query of pickedForYouQueries) {
      // Check cache first
      const cached = getCachedSearch(query);
      if (cached) {
        pickedForYouVideos.push(...cached.slice(0, 4));
        continue;
      }

      try {
        const results = await searchRecipeVideos(query);
        setCachedSearch(query, results);
        pickedForYouVideos.push(...results.slice(0, 4));
      } catch (err) {
        console.error("Picked-for-you search failed:", query, err);
        // Continue — partial data is fine
      }
    }

    res.json({
      pickedForYou: pickedForYouVideos,
      trending: {
        cuisine: effectiveTrendingCuisine,
        recipes: trendingRecipes,
      },
      quickTonight: quickTonightRecipes,
      deepDive: {
        cuisine: effectiveDeepDiveCuisine,
        recipes: deepDiveRecipes,
      },
      challenge: challengeRecipes,
    });
  } catch (error) {
    console.error("Feed endpoint error:", error);
    res.status(500).json({ error: "Failed to fetch homepage feed" });
  }
});

export default router;
