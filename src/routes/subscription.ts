import { Router } from "express";
import { db } from "../lib/firebase";
import { getCurrentWeekStart } from "../lib/week";
import type { AuthRequest, UserDocument } from "../lib/auth-types";

const router = Router();

const FREE_TOTAL_LIMIT = 5;
const PRO_WEEKLY_LIMIT = 50;

/** Auto-reset weekly count if the week has rolled over. Returns the effective data. */
function resolveWeeklyData(user: UserDocument): { count: number; weekStart: string } {
  const currentWeek = getCurrentWeekStart();
  if (!user.weeklyExtractions || user.weeklyExtractions.weekStart !== currentWeek) {
    return { count: 0, weekStart: currentWeek };
  }
  return user.weeklyExtractions;
}

// GET /api/subscription/status
router.get("/status", async (req: AuthRequest, res) => {
  try {
    const doc = await db.collection("users").doc(req.uid!).get();
    if (!doc.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = doc.data() as UserDocument;
    const isPro = user.isPro ?? false;
    const weekly = resolveWeeklyData(user);
    const recipesUsed = user.recipesUsed ?? 0;

    // Persist the weekly reset if week rolled over
    if (
      !user.weeklyExtractions ||
      user.weeklyExtractions.weekStart !== weekly.weekStart
    ) {
      await db.collection("users").doc(req.uid!).update({
        weeklyExtractions: weekly,
      });
    }

    const remaining = isPro
      ? Math.max(0, PRO_WEEKLY_LIMIT - weekly.count)
      : Math.max(0, FREE_TOTAL_LIMIT - recipesUsed);

    const limit = isPro ? PRO_WEEKLY_LIMIT : FREE_TOTAL_LIMIT;

    res.json({
      isPro,
      recipesUsed,
      weeklyExtractions: weekly,
      remaining,
      limit,
    });
  } catch (error) {
    console.error("Subscription status error:", error);
    res.status(500).json({ error: "Failed to fetch subscription status" });
  }
});

// POST /api/subscription/activate-pro
router.post("/activate-pro", async (req: AuthRequest, res) => {
  try {
    const userRef = db.collection("users").doc(req.uid!);
    const doc = await userRef.get();
    if (!doc.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = doc.data() as UserDocument;
    const weekly = resolveWeeklyData(user);

    await userRef.update({
      isPro: true,
      weeklyExtractions: { count: 0, weekStart: weekly.weekStart },
      updatedAt: new Date().toISOString(),
    });

    res.json({
      isPro: true,
      recipesUsed: user.recipesUsed ?? 0,
      weeklyExtractions: { count: 0, weekStart: weekly.weekStart },
      remaining: PRO_WEEKLY_LIMIT,
      limit: PRO_WEEKLY_LIMIT,
    });
  } catch (error) {
    console.error("Activate pro error:", error);
    res.status(500).json({ error: "Failed to activate pro" });
  }
});

// POST /api/subscription/use-extraction
router.post("/use-extraction", async (req: AuthRequest, res) => {
  try {
    const userRef = db.collection("users").doc(req.uid!);

    const result = await db.runTransaction(async (tx) => {
      const doc = await tx.get(userRef);
      if (!doc.exists) throw new Error("User not found");

      const user = doc.data() as UserDocument;
      const isPro = user.isPro ?? false;
      const weekly = resolveWeeklyData(user);
      const recipesUsed = user.recipesUsed ?? 0;

      if (isPro) {
        // Pro: weekly limit
        if (weekly.count >= PRO_WEEKLY_LIMIT) {
          return { allowed: false, remaining: 0, isPro: true };
        }
        const newCount = weekly.count + 1;
        tx.update(userRef, {
          weeklyExtractions: { count: newCount, weekStart: weekly.weekStart },
        });
        return {
          allowed: true,
          remaining: Math.max(0, PRO_WEEKLY_LIMIT - newCount),
          isPro: true,
        };
      }

      // Free: total lifetime limit
      if (recipesUsed >= FREE_TOTAL_LIMIT) {
        return { allowed: false, remaining: 0, isPro: false };
      }
      const newUsed = recipesUsed + 1;
      tx.update(userRef, {
        recipesUsed: newUsed,
        updatedAt: new Date().toISOString(),
      });
      return {
        allowed: true,
        remaining: Math.max(0, FREE_TOTAL_LIMIT - newUsed),
        isPro: false,
      };
    });

    res.json(result);
  } catch (error: any) {
    if (error.message === "User not found") {
      res.status(404).json({ error: "User not found" });
      return;
    }
    console.error("Use extraction error:", error);
    res.status(500).json({ error: "Failed to process extraction" });
  }
});

export default router;
