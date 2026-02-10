import { Router } from "express";
import { db } from "../lib/firebase";
import type { AuthRequest, UserPreferences } from "../lib/auth-types";

const router = Router();

// PUT /api/user/preferences
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

export default router;
