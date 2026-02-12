import { GoogleGenerativeAI } from "@google/generative-ai";
import { buildExtractionPrompt } from "../extraction-prompt";
import type { ExtractionOutput, RecipeExtractor, StreamCallback } from "./types";

const MODEL_ID = process.env.GEMINI_MODEL || "gemini-2.5-flash";

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

// ── Incremental JSON field extraction ──────────────────────

interface IncrementalState {
  emittedScalars: Set<string>;
  emittedIngredientCount: number;
  emittedInstructionCount: number;
}

const SCALAR_PATTERNS: Array<{
  key: string;
  pattern: RegExp;
  parse: (m: RegExpMatchArray) => unknown;
}> = [
  { key: "servings", pattern: /"servings"\s*:\s*(\d+)/, parse: (m) => Number(m[1]) },
  { key: "prep_time_minutes", pattern: /"prep_time_minutes"\s*:\s*(\d+)/, parse: (m) => Number(m[1]) },
  { key: "cook_time_minutes", pattern: /"cook_time_minutes"\s*:\s*(\d+)/, parse: (m) => Number(m[1]) },
  { key: "calories_kcal", pattern: /"calories_kcal"\s*:\s*(\d+)/, parse: (m) => Number(m[1]) },
  { key: "difficulty", pattern: /"difficulty"\s*:\s*(\d+)/, parse: (m) => Number(m[1]) },
  { key: "cuisine", pattern: /"cuisine"\s*:\s*"([^"]+)"/, parse: (m) => m[1] },
];

function extractCompletedArrayItems(
  buffer: string,
  arrayKey: string
): unknown[] {
  // Find the array start
  const keyPattern = new RegExp(`"${arrayKey}"\\s*:\\s*\\[`);
  const keyMatch = keyPattern.exec(buffer);
  if (!keyMatch) return [];

  const arrayStart = keyMatch.index + keyMatch[0].length;
  const items: unknown[] = [];

  // Walk through the buffer character by character to find completed items
  let depth = 0;
  let inString = false;
  let escaped = false;
  let itemStart = -1;

  for (let i = arrayStart; i < buffer.length; i++) {
    const ch = buffer[i];

    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      continue;
    }
    if (ch === '"') {
      inString = !inString;
      // For string arrays (instructions), mark item start at opening quote
      if (inString && depth === 0 && itemStart === -1) {
        itemStart = i;
      }
      continue;
    }
    if (inString) continue;

    if (ch === "{") {
      if (depth === 0) itemStart = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && itemStart !== -1) {
        const itemStr = buffer.slice(itemStart, i + 1);
        try {
          items.push(JSON.parse(itemStr));
        } catch {
          // incomplete item, skip
        }
        itemStart = -1;
      }
    } else if (ch === "]" && depth === 0) {
      // Array closed — also catch any trailing string items
      break;
    }
  }

  // For string arrays, also extract quoted strings at depth 0
  if (items.length === 0) {
    const stringPattern = /(?:^|,)\s*"((?:[^"\\]|\\.)*)"\s*(?=,|])/g;
    const arrayContent = buffer.slice(arrayStart);
    let match;
    while ((match = stringPattern.exec(arrayContent)) !== null) {
      items.push(match[1].replace(/\\"/g, '"').replace(/\\n/g, "\n"));
    }
  }

  return items;
}

function processChunk(
  buffer: string,
  state: IncrementalState,
  onEvent: StreamCallback
): void {
  // Check scalar fields
  for (const { key, pattern, parse } of SCALAR_PATTERNS) {
    if (state.emittedScalars.has(key)) continue;
    const match = pattern.exec(buffer);
    if (match) {
      state.emittedScalars.add(key);
      onEvent({ type: "metadata", data: { [key]: parse(match) } });
    }
  }

  // Check ingredients
  const ingredients = extractCompletedArrayItems(buffer, "ingredients") as Array<{
    name: string;
    quantity: string;
  }>;
  for (let i = state.emittedIngredientCount; i < ingredients.length; i++) {
    onEvent({ type: "ingredient", data: ingredients[i] });
    state.emittedIngredientCount = i + 1;
  }

  // Check instructions
  const instructions = extractCompletedArrayItems(buffer, "instructions") as string[];
  for (let i = state.emittedInstructionCount; i < instructions.length; i++) {
    onEvent({ type: "instruction", data: { index: i, text: instructions[i] } });
    state.emittedInstructionCount = i + 1;
  }
}

// ── Extractor ──────────────────────────────────────────────

const GENERATION_CONFIG = {
  responseMimeType: "application/json" as const,
  temperature: 0.2,
};

export const geminiRecipeExtractor: RecipeExtractor = {
  async extractRecipeFromTranscript(transcript: string): Promise<ExtractionOutput> {
    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: GENERATION_CONFIG,
    });

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

  async extractRecipeFromTranscriptStream(
    transcript: string,
    onEvent: StreamCallback
  ): Promise<ExtractionOutput> {
    const apiKey = getApiKey();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({
      model: MODEL_ID,
      generationConfig: GENERATION_CONFIG,
    });

    const prompt = buildExtractionPrompt(transcript);
    const t0 = Date.now();
    const result = await model.generateContentStream(prompt);

    let buffer = "";
    let chunkCount = 0;
    let firstEventEmitted = false;
    const state: IncrementalState = {
      emittedScalars: new Set(),
      emittedIngredientCount: 0,
      emittedInstructionCount: 0,
    };

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        chunkCount++;
        if (chunkCount === 1) {
          console.log(`[gemini-stream] first chunk at ${Date.now() - t0}ms`);
        }
        buffer += text;
        const prevScalars = state.emittedScalars.size;
        const prevIngredients = state.emittedIngredientCount;
        processChunk(buffer, state, onEvent);
        if (!firstEventEmitted && (state.emittedScalars.size > prevScalars || state.emittedIngredientCount > prevIngredients)) {
          firstEventEmitted = true;
          console.log(`[gemini-stream] first data event at ${Date.now() - t0}ms (chunk #${chunkCount}, buffer ${buffer.length} chars)`);
        }
      }
    }

    console.log(`[gemini-stream] done: ${chunkCount} chunks, ${buffer.length} chars, ${Date.now() - t0}ms`);

    // Parse the final complete response
    const finalOutput = parseOutput(buffer);
    onEvent({ type: "complete", data: finalOutput });
    return finalOutput;
  },
};
