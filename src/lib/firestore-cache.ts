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
