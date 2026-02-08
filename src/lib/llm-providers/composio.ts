import { getComposioClient } from "../composio";
import { buildExtractionCode } from "../composio";
import type { ExtractionOutput, RecipeExtractor } from "./types";

function parseOutput(stdout: string): ExtractionOutput {
  const output = JSON.parse(stdout.trim()) as Record<string, unknown>;
  return {
    ingredients: Array.isArray(output.ingredients) ? output.ingredients : [],
    instructions: Array.isArray(output.instructions) ? output.instructions : [],
    servings: typeof output.servings === "number" ? output.servings : 0,
    prep_time_minutes:
      typeof output.prep_time_minutes === "number" ? output.prep_time_minutes : 0,
    cook_time_minutes:
      typeof output.cook_time_minutes === "number" ? output.cook_time_minutes : 0,
    allergens: Array.isArray(output.allergens) ? output.allergens : [],
    calories_kcal:
      typeof output.calories_kcal === "number" ? output.calories_kcal : 0,
    difficulty: typeof output.difficulty === "number" ? output.difficulty : 1,
    cuisine: typeof output.cuisine === "string" ? output.cuisine : "OTHER",
    accompanying_recipes: Array.isArray(output.accompanying_recipes) ? output.accompanying_recipes : [],
  };
}

export const composioRecipeExtractor: RecipeExtractor = {
  async extractRecipeFromTranscript(transcript: string): Promise<ExtractionOutput> {
    const composio = getComposioClient();
    const code = buildExtractionCode(transcript);

    const result = await composio.tools.execute("COMPOSIO_REMOTE_WORKBENCH", {
      arguments: { code_to_execute: code },
    });

    if (!result.successful) {
      const error =
        (result.data as Record<string, string>)?.error ?? "Unknown error";
      throw new Error(`Workbench error: ${error}`);
    }

    const data = result.data as Record<string, string>;
    const stdout = data?.stdout ?? "";
    const stderr = data?.stderr ?? "";

    if (!stdout.trim()) {
      throw new Error(
        stderr
          ? `Could not process video. ${stderr.slice(0, 200)}`
          : "No output returned."
      );
    }

    return parseOutput(stdout);
  },
};
