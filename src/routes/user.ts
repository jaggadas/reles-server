import { Router } from "express";
import { db } from "../lib/firebase";
import type { AuthRequest, UserPreferences } from "../lib/auth-types";
import { getRecipeCacheDoc, getRecipeCacheBatch } from "../lib/firestore-cache";

const router = Router();

// ── Helpers ──────────────────────────────────────────────────

function assembleRecipe(
  videoId: string,
  savedAt: string,
  cacheData: Record<string, unknown>
) {
  return {
    id: videoId,
    videoId,
    title: (cacheData.title as string) || "Untitled Recipe",
    videoTitle: (cacheData.videoTitle as string) || (cacheData.title as string) || "",
    channelTitle: (cacheData.channelTitle as string) || "",
    thumbnail: `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    ingredients: (cacheData.ingredients as unknown[]) || [],
    instructions: (cacheData.instructions as unknown[]) || [],
    servings: cacheData.servings ?? 0,
    prepTimeMinutes: cacheData.prepTimeMinutes ?? 0,
    cookTimeMinutes: cacheData.cookTimeMinutes ?? 0,
    allergens: (cacheData.allergens as string[]) || [],
    caloriesKcal: cacheData.caloriesKcal ?? 0,
    difficulty: cacheData.difficulty ?? 0,
    cuisine: (cacheData.cuisine as string) || "OTHER",
    accompanyingRecipes: (cacheData.accompanyingRecipes as string[]) || [],
    highlights: (cacheData.highlights as string[]) || [],
    createdAt: savedAt,
  };
}

// ── PUT /api/user/preferences ────────────────────────────────

router.put("/preferences", async (req: AuthRequest, res) => {
  const {
    likedCuisines,
    dietaryRestrictions,
    favoriteCategories,
    allergens,
  } = req.body;

  if (!likedCuisines || !dietaryRestrictions || !favoriteCategories || !Array.isArray(allergens)) {
    res.status(400).json({ error: "All preference fields are required" });
    return;
  }

  const preferences: UserPreferences = {
    likedCuisines,
    dietaryRestrictions: {
      isVegetarian: !!dietaryRestrictions.isVegetarian,
      isVegan: !!dietaryRestrictions.isVegan,
    },
    favoriteCategories,
    allergens: allergens.map((a: unknown) => String(a).toLowerCase()),
  };

  try {
    await db.collection("users").doc(req.uid!).update({
      preferences,
      updatedAt: new Date().toISOString(),
    });

    res.json({ message: "Preferences saved", preferences });
  } catch (error) {
    console.error("Save preferences error:", error);
    res.status(500).json({ error: "Failed to save preferences" });
  }
});

// ── POST /api/user/recipes/:videoId — Save a recipe ──────────

router.post("/recipes/:videoId", async (req: AuthRequest, res) => {
  const { videoId } = req.params;

  try {
    const cacheData = await getRecipeCacheDoc(videoId);
    if (!cacheData) {
      res.status(404).json({ error: "Recipe not found in cache" });
      return;
    }

    const savedAt = new Date().toISOString();
    await db
      .collection("users")
      .doc(req.uid!)
      .collection("saved_recipes")
      .doc(videoId)
      .set({ videoId, savedAt });

    res.status(201).json({ savedAt });
  } catch (error) {
    console.error("Save recipe error:", error);
    res.status(500).json({ error: "Failed to save recipe" });
  }
});

// ── DELETE /api/user/recipes/:videoId — Unsave a recipe ──────

router.delete("/recipes/:videoId", async (req: AuthRequest, res) => {
  const { videoId } = req.params;

  try {
    const ref = db
      .collection("users")
      .doc(req.uid!)
      .collection("saved_recipes")
      .doc(videoId);

    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: "Recipe not saved" });
      return;
    }

    await ref.delete();
    res.json({ deleted: true });
  } catch (error) {
    console.error("Delete recipe error:", error);
    res.status(500).json({ error: "Failed to delete recipe" });
  }
});

// ── GET /api/user/recipes — List all saved recipes ───────────

router.get("/recipes", async (req: AuthRequest, res) => {
  try {
    const snapshot = await db
      .collection("users")
      .doc(req.uid!)
      .collection("saved_recipes")
      .orderBy("savedAt", "desc")
      .get();

    if (snapshot.empty) {
      res.json({ recipes: [] });
      return;
    }

    const savedDocs = snapshot.docs.map((doc) => doc.data() as { videoId: string; savedAt: string });
    const videoIds = savedDocs.map((d) => d.videoId);

    const cacheMap = await getRecipeCacheBatch(videoIds);

    const recipes = savedDocs
      .filter((d) => cacheMap.has(d.videoId))
      .map((d) => assembleRecipe(d.videoId, d.savedAt, cacheMap.get(d.videoId)!));

    res.json({ recipes });
  } catch (error) {
    console.error("List recipes error:", error);
    res.status(500).json({ error: "Failed to fetch recipes" });
  }
});

// ── GET /api/user/recipes/check/:videoId — Check if saved ────

router.get("/recipes/check/:videoId", async (req: AuthRequest, res) => {
  const { videoId } = req.params;

  try {
    const doc = await db
      .collection("users")
      .doc(req.uid!)
      .collection("saved_recipes")
      .doc(videoId)
      .get();

    if (doc.exists) {
      const data = doc.data() as { savedAt: string };
      res.json({ saved: true, savedAt: data.savedAt });
    } else {
      res.json({ saved: false });
    }
  } catch (error) {
    console.error("Check recipe error:", error);
    res.status(500).json({ error: "Failed to check recipe" });
  }
});

// ── GET /api/user/recipes/:videoId — Get single saved recipe ─

router.get("/recipes/:videoId", async (req: AuthRequest, res) => {
  const { videoId } = req.params;

  try {
    const savedDoc = await db
      .collection("users")
      .doc(req.uid!)
      .collection("saved_recipes")
      .doc(videoId)
      .get();

    if (!savedDoc.exists) {
      res.status(404).json({ error: "Recipe not saved" });
      return;
    }

    const { savedAt } = savedDoc.data() as { savedAt: string };
    const cacheData = await getRecipeCacheDoc(videoId);

    if (!cacheData) {
      res.status(404).json({ error: "Recipe data not found" });
      return;
    }

    res.json({ recipe: assembleRecipe(videoId, savedAt, cacheData) });
  } catch (error) {
    console.error("Get recipe error:", error);
    res.status(500).json({ error: "Failed to fetch recipe" });
  }
});

export default router;
