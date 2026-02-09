import "dotenv/config";
import express from "express";
import cors from "cors";
import "./lib/firebase";
import videoRoutes from "./routes/video";
import recipeRoutes from "./routes/recipe";
import groceryRoutes from "./routes/grocery";
import authRoutes from "./routes/auth";
import userRoutes from "./routes/user";
import { requireAuth } from "./middleware/auth";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// Public routes
app.use("/api/auth", authRoutes);

// Protected routes
app.use("/api/user", requireAuth, userRoutes);
app.use("/api/video", requireAuth, videoRoutes);
app.use("/api/recipe", requireAuth, recipeRoutes);
app.use("/api/grocery", requireAuth, groceryRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Reles server running on http://localhost:${PORT}`);
});
