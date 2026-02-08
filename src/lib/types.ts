export interface Ingredient {
  name: string;
  quantity: string;
  category?: string;
}

export type CuisineCategory =
  | "AMERICAN"
  | "ITALIAN"
  | "FRENCH"
  | "SPANISH"
  | "MEXICAN"
  | "BRAZILIAN"
  | "MEDITERRANEAN"
  | "MIDDLE_EASTERN"
  | "INDIAN"
  | "CHINESE"
  | "JAPANESE"
  | "KOREAN"
  | "THAI"
  | "VIETNAMESE"
  | "ASIAN_OTHER"
  | "AFRICAN"
  | "CARIBBEAN"
  | "LATIN_AMERICAN"
  | "EUROPEAN_OTHER"
  | "OTHER";

export interface Recipe {
  id: string;
  videoId: string;
  title: string;
  videoTitle?: string;
  channelTitle?: string;
  thumbnail: string;
  url: string;
  ingredients: Ingredient[];
  instructions: string[];
  createdAt: string;
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  allergens?: string[];
  caloriesKcal?: number;
  difficulty?: number;
  cuisine?: CuisineCategory;
  accompanyingRecipes?: string[];
}

export interface ExtractedRecipe {
  videoId: string;
  title: string;
  ingredients: Ingredient[];
  instructions: string[];
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  allergens?: string[];
  caloriesKcal?: number;
  difficulty?: number;
  cuisine?: CuisineCategory;
  accompanyingRecipes?: string[];
}

export interface VideoDetails {
  title: string;
  channelTitle: string;
}

export interface VideoSearchResult {
  videoId: string;
  title: string;
  channelName: string;
  thumbnail: string;
  url: string;
}

export type ExtractionPhase = "idle" | "fetching" | "fetching-transcript" | "reading" | "extracting" | "success";

export type AisleCategory =
  | "produce"
  | "meat-seafood"
  | "dairy-eggs"
  | "bakery"
  | "frozen"
  | "pantry"
  | "spices-seasonings"
  | "condiments-sauces"
  | "beverages"
  | "other";

export interface GroceryItem {
  id: string;
  name: string;
  displayQuantity: string;
  aisle: AisleCategory;
  checked: boolean;
  sources: {
    recipeId: string;
    recipeTitle: string;
    quantity: string;
  }[];
  addedAt: string;
}
