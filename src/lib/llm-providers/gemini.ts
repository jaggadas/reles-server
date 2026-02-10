import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildExtractionPrompt } from "../extraction-prompt";
import type { ExtractionOutput, RecipeExtractor } from "./types";

const MODEL_ID = "gemini-3-flash-preview";

function getApiKey(): string {
  const key =
    process.env.GOOGLE_AI_API_KEY ?? process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      "GOOGLE_AI_API_KEY or GEMINI_API_KEY required when LLM_PROVIDER=gemini"
    );
  }
  return key;
}

function cleanJsonResponse(text: string): string {
  let cleaned = text.trim();
  if (cleaned.startsWith("```")) {
    const lines = cleaned.split("\n");
    cleaned = lines.slice(1).join("\n");
  }
  if (cleaned.endsWith("```")) {
    cleaned = cleaned.slice(0, -3).trim();
  }
  return cleaned;
}

function parseOutput(text: string): ExtractionOutput {
  const cleaned = cleanJsonResponse(text);
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  return {
    ingredients: Array.isArray(parsed.ingredients) ? parsed.ingredients : [],
    instructions: Array.isArray(parsed.instructions) ? parsed.instructions : [],
    servings: typeof parsed.servings === "number" ? parsed.servings : 0,
    prep_time_minutes:
      typeof parsed.prep_time_minutes === "number" ? parsed.prep_time_minutes : 0,
    cook_time_minutes:
      typeof parsed.cook_time_minutes === "number" ? parsed.cook_time_minutes : 0,
    allergens: Array.isArray(parsed.allergens) ? parsed.allergens : [],
    calories_kcal:
      typeof parsed.calories_kcal === "number" ? parsed.calories_kcal : 0,
    difficulty: typeof parsed.difficulty === "number" ? parsed.difficulty : 1,
    cuisine: typeof parsed.cuisine === "string" ? parsed.cuisine : "OTHER",
    accompanying_recipes: Array.isArray(parsed.accompanying_recipes) ? parsed.accompanying_recipes : [],
    highlights: Array.isArray(parsed.highlights) ? parsed.highlights as string[] : [],
  };
}

export const geminiRecipeExtractor: RecipeExtractor = {
  async extractRecipeFromTranscript(transcript: string): Promise<ExtractionOutput> {
    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: MODEL_ID });

    const prompt = buildExtractionPrompt(transcript);
    const result = await model.generateContent(prompt);
    const response = result.response;

    if (!response) {
      throw new Error("No response from Gemini");
    }

    const text = response.text();
    if (!text) {
      throw new Error("Empty response from Gemini");
    }

    return parseOutput(text);
  },
};
