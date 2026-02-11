import { Router } from "express";
import bcrypt from "bcrypt";
import { v4 as uuidv4 } from "uuid";
import { db } from "../lib/firebase";
import { signToken, requireAuth } from "../middleware/auth";
import { getCurrentWeekStart } from "../lib/week";
import type { AuthRequest, UserDocument } from "../lib/auth-types";

const router = Router();

// POST /api/auth/register
router.post("/register", async (req, res) => {
  const { email, password, name } = req.body;

  if (!email || !password || !name) {
    res.status(400).json({ error: "Email, password, and name are required" });
    return;
  }

  try {
    // Check if email already exists
    const existing = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (!existing.empty) {
      res.status(409).json({ error: "Email already registered" });
      return;
    }

    const uid = uuidv4();
    const passwordHash = await bcrypt.hash(password, 10);
    const now = new Date().toISOString();

    const userDoc: UserDocument = {
      uid,
      email,
      name,
      passwordHash,
      preferences: null,
      trial: null,
      weeklyExtractions: { count: 0, weekStart: getCurrentWeekStart() },
      createdAt: now,
      updatedAt: now,
    };

    await db.collection("users").doc(uid).set(userDoc);

    const token = signToken(uid);

    res.status(201).json({
      token,
      user: {
        uid,
        email,
        name,
        preferences: null,
        createdAt: now,
      },
    });
  } catch (error) {
    console.error("Register error:", error);
    res.status(500).json({ error: "Failed to register user" });
  }
});

// POST /api/auth/check-email
router.post("/check-email", async (req, res) => {
  const { email } = req.body;

  if (!email || typeof email !== "string" || !email.trim()) {
    res.status(400).json({ error: "Email is required" });
    return;
  }

  try {
    const snapshot = await db
      .collection("users")
      .where("email", "==", email.toLowerCase().trim())
      .limit(1)
      .get();

    res.json({ exists: !snapshot.empty });
  } catch (error) {
    console.error("Check email error:", error);
    res.status(500).json({ error: "Failed to check email" });
  }
});

// POST /api/auth/login
router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    res.status(400).json({ error: "Email and password are required" });
    return;
  }

  try {
    const snapshot = await db
      .collection("users")
      .where("email", "==", email)
      .limit(1)
      .get();

    if (snapshot.empty) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const userDoc = snapshot.docs[0].data() as UserDocument;
    const valid = await bcrypt.compare(password, userDoc.passwordHash);

    if (!valid) {
      res.status(401).json({ error: "Invalid credentials" });
      return;
    }

    const token = signToken(userDoc.uid);

    res.json({
      token,
      user: {
        uid: userDoc.uid,
        email: userDoc.email,
        name: userDoc.name,
        preferences: userDoc.preferences,
        createdAt: userDoc.createdAt,
      },
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Failed to login" });
  }
});

// GET /api/auth/me
router.get("/me", requireAuth, async (req: AuthRequest, res) => {
  try {
    const doc = await db.collection("users").doc(req.uid!).get();

    if (!doc.exists) {
      res.status(404).json({ error: "User not found" });
      return;
    }

    const user = doc.data() as UserDocument;

    res.json({
      uid: user.uid,
      email: user.email,
      name: user.name,
      preferences: user.preferences,
      createdAt: user.createdAt,
    });
  } catch (error) {
    console.error("Get me error:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
});

export default router;
