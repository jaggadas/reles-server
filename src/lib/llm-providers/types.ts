/**
 * Raw extraction output from LLM providers (snake_case).
 */

export interface ExtractionOutput {
  ingredients: Array<{ name: string; quantity: string }>;
  instructions: string[];
  servings: number;
  prep_time_minutes: number;
  cook_time_minutes: number;
  allergens: string[];
  calories_kcal: number;
  difficulty: number;
  cuisine: string;
  accompanying_recipes: string[];
  highlights?: string[];
}

export interface RecipeExtractor {
  extractRecipeFromTranscript(transcript: string): Promise<ExtractionOutput>;
}
