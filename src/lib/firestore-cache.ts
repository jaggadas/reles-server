import { db } from "./firebase";

interface CachedRecipe {
  videoId: string;
  extractedJson: Record<string, unknown>;
  createdAt: string;
  timesAccessed: number;
  timesMade: number;
  lastAccessedAt: string;
}

export async function getCachedRecipe(videoId: string): Promise<Record<string, unknown> | null> {
  const doc = await db.collection("recipe_cache").doc(videoId).get();

  if (!doc.exists) return null;

  const data = doc.data() as CachedRecipe;

  // Increment access count in background
  db.collection("recipe_cache").doc(videoId).update({
    timesAccessed: (data.timesAccessed || 0) + 1,
    lastAccessedAt: new Date().toISOString(),
  });

  return data.extractedJson;
}

export async function cacheRecipe(videoId: string, json: Record<string, unknown>): Promise<void> {
  const now = new Date().toISOString();

  await db.collection("recipe_cache").doc(videoId).set({
    videoId,
    extractedJson: json,
    // Denormalized fields for efficient Firestore queries
    title: (json.title as string) || "Untitled",
    channelTitle: (json.channelTitle as string) || "",
    cuisine: (json.cuisine as string) || "OTHER",
    difficulty: (json.difficulty as number) || 0,
    totalTimeMinutes:
      ((json.prepTimeMinutes as number) || 0) +
      ((json.cookTimeMinutes as number) || 0),
    allergens: (json.allergens as string[]) || [],
    createdAt: now,
    timesAccessed: 1,
    timesMade: 0,
    lastAccessedAt: now,
  });
}

export async function incrementTimesMade(videoId: string): Promise<number> {
  const ref = db.collection("recipe_cache").doc(videoId);
  const doc = await ref.get();

  if (!doc.exists) {
    return 0;
  }

  const current = (doc.data() as CachedRecipe).timesMade || 0;
  const updated = current + 1;

  await ref.update({ timesMade: updated });
  return updated;
}

export async function getPopularRecipes(limit: number = 10) {
  const snapshot = await db
    .collection("recipe_cache")
    .orderBy("timesMade", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map((doc) => {
    const data = doc.data() as CachedRecipe;
    const title =
      (data.extractedJson as Record<string, unknown>)?.title || "Untitled";
    return {
      videoId: data.videoId,
      title,
      timesMade: data.timesMade,
      timesAccessed: data.timesAccessed,
    };
  });
}

// ── Feed query helpers ──────────────────────────────────────

export interface FeedRecipe {
  videoId: string;
  title: string;
  channelTitle: string;
  cuisine: string;
  difficulty: number;
  caloriesKcal: number;
  cookTimeMinutes: number;
  prepTimeMinutes: number;
  totalTimeMinutes: number;
  allergens: string[];
  highlights: string[];
  timesAccessed: number;
  timesMade: number;
}

function docToFeedRecipe(doc: FirebaseFirestore.DocumentData): FeedRecipe {
  const data = doc.data();
  const json = (data.extractedJson || {}) as Record<string, unknown>;
  return {
    videoId: data.videoId,
    title: data.title || (json.title as string) || "Untitled",
    channelTitle: data.channelTitle || (json.channelTitle as string) || "",
    cuisine: data.cuisine || (json.cuisine as string) || "OTHER",
    difficulty: data.difficulty || (json.difficulty as number) || 0,
    caloriesKcal: (json.caloriesKcal as number) || 0,
    cookTimeMinutes: (json.cookTimeMinutes as number) || 0,
    prepTimeMinutes: (json.prepTimeMinutes as number) || 0,
    totalTimeMinutes:
      data.totalTimeMinutes ||
      ((json.prepTimeMinutes as number) || 0) +
        ((json.cookTimeMinutes as number) || 0),
    allergens: data.allergens || (json.allergens as string[]) || [],
    highlights: (json.highlights as string[]) || [],
    timesAccessed: data.timesAccessed || 0,
    timesMade: data.timesMade || 0,
  };
}

export async function getRecipesByCuisine(
  cuisine: string,
  limit: number = 4
): Promise<FeedRecipe[]> {
  try {
    const snapshot = await db
      .collection("recipe_cache")
      .where("cuisine", "==", cuisine)
      .orderBy("timesAccessed", "desc")
      .limit(limit)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs.map(docToFeedRecipe);
    }
  } catch {
    // Missing composite index — fall through to in-memory scan
  }

  const fallback = await db
    .collection("recipe_cache")
    .orderBy("timesAccessed", "desc")
    .limit(limit * 5)
    .get();

  return fallback.docs
    .map(docToFeedRecipe)
    .filter((r) => r.cuisine === cuisine)
    .slice(0, limit);
}

export async function getQuickRecipes(
  excludeAllergens: string[],
  limit: number = 6
): Promise<FeedRecipe[]> {
  try {
    const snapshot = await db
      .collection("recipe_cache")
      .where("totalTimeMinutes", ">", 0)
      .where("totalTimeMinutes", "<=", 30)
      .orderBy("totalTimeMinutes", "asc")
      .limit(limit * 3)
      .get();

    if (!snapshot.empty) {
      return snapshot.docs
        .map(docToFeedRecipe)
        .filter((r) => {
          if (excludeAllergens.length === 0) return true;
          return !excludeAllergens.some((a) => r.allergens.includes(a));
        })
        .slice(0, limit);
    }
  } catch {
    // Missing composite index — fall through to in-memory scan
  }

  const fallback = await db
    .collection("recipe_cache")
    .orderBy("timesAccessed", "desc")
    .limit(50)
    .get();

  return fallback.docs
    .map(docToFeedRecipe)
    .filter((r) => r.totalTimeMinutes > 0 && r.totalTimeMinutes <= 30)
    .filter((r) => {
      if (excludeAllergens.length === 0) return true;
      return !excludeAllergens.some((a) => r.allergens.includes(a));
    })
    .slice(0, limit);
}

export async function getChallengeRecipes(
  cuisines: string[],
  limit: number = 4
): Promise<FeedRecipe[]> {
  try {
    const snapshot = await db
      .collection("recipe_cache")
      .where("difficulty", ">=", 3)
      .orderBy("difficulty", "asc")
      .orderBy("timesAccessed", "desc")
      .limit(limit * 3)
      .get();

    if (!snapshot.empty) {
      const recipes = snapshot.docs.map(docToFeedRecipe);
      if (cuisines.length === 0) return recipes.slice(0, limit);
      return recipes
        .filter((r) => cuisines.includes(r.cuisine))
        .slice(0, limit);
    }
  } catch {
    // Missing composite index — fall through to in-memory scan
  }

  const fallback = await db
    .collection("recipe_cache")
    .orderBy("timesAccessed", "desc")
    .limit(50)
    .get();

  return fallback.docs
    .map(docToFeedRecipe)
    .filter((r) => r.difficulty >= 3)
    .filter((r) => cuisines.length === 0 || cuisines.includes(r.cuisine))
    .slice(0, limit);
}

export async function getRecipesByCuisineDetailed(
  cuisine: string,
  limit: number = 4
): Promise<FeedRecipe[]> {
  // Same query as getRecipesByCuisine — FeedRecipe already has all detailed fields
  return getRecipesByCuisine(cuisine, limit);
}

export async function getPopularFeedRecipes(
  limit: number = 6
): Promise<FeedRecipe[]> {
  const snapshot = await db
    .collection("recipe_cache")
    .orderBy("timesAccessed", "desc")
    .limit(limit)
    .get();

  return snapshot.docs.map(docToFeedRecipe);
}
