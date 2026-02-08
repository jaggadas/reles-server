import type { RecipeExtractor } from "./types";
import { composioRecipeExtractor } from "./composio";
import { geminiRecipeExtractor } from "./gemini";

const VALID_PROVIDERS = ["composio", "gemini"] as const;
type ProviderName = (typeof VALID_PROVIDERS)[number];

function getProviderName(): ProviderName {
  const raw = process.env.LLM_PROVIDER?.toLowerCase().trim() ?? "composio";
  if (VALID_PROVIDERS.includes(raw as ProviderName)) {
    return raw as ProviderName;
  }
  throw new Error(
    `Invalid LLM_PROVIDER="${raw}". Must be one of: ${VALID_PROVIDERS.join(", ")}`
  );
}

export function getRecipeExtractor(): RecipeExtractor {
  const provider = getProviderName();
  switch (provider) {
    case "composio":
      return composioRecipeExtractor;
    case "gemini":
      return geminiRecipeExtractor;
    default:
      throw new Error(`Unknown LLM provider: ${provider}`);
  }
}
