import "dotenv/config";
import express from "express";
import cors from "cors";
import videoRoutes from "./routes/video";
import recipeRoutes from "./routes/recipe";
import groceryRoutes from "./routes/grocery";

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

app.use("/api/video", videoRoutes);
app.use("/api/recipe", recipeRoutes);
app.use("/api/grocery", groceryRoutes);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

app.listen(PORT, () => {
  console.log(`Reles server running on http://localhost:${PORT}`);
});
