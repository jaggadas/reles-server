import { Composio } from "@composio/client";
import { RECIPE_EXTRACTION_PROMPT_PREFIX } from "./extraction-prompt";

let client: Composio | null = null;

export function getComposioClient(): Composio {
  if (!client) {
    const apiKey = process.env.COMPOSIO_API_KEY;
    if (!apiKey) {
      throw new Error("COMPOSIO_API_KEY not configured");
    }
    client = new Composio({ apiKey });
  }
  return client;
}

export function buildExtractionCode(transcript: string): string {
  const b64 = Buffer.from(transcript).toString("base64");
  const promptPrefixB64 = Buffer.from(RECIPE_EXTRACTION_PROMPT_PREFIX).toString(
    "base64"
  );
  return `import base64
import json

transcript = base64.b64decode("${b64}").decode("utf-8")
prompt_prefix = base64.b64decode("${promptPrefixB64}").decode("utf-8")
prompt = prompt_prefix + transcript

result, error = invoke_llm(prompt, reasoning_effort="medium")
if error:
    raise Exception(f"LLM error: {error}")

cleaned = result.strip()
if cleaned.startswith("\`\`\`"):
    lines = cleaned.split("\\n")
    cleaned = "\\n".join(lines[1:])
if cleaned.endswith("\`\`\`"):
    cleaned = cleaned[:-3].strip()

parsed = json.loads(cleaned)
if isinstance(parsed, list):
    parsed = {"ingredients": parsed, "instructions": []}
output = json.dumps({"ingredients": parsed.get("ingredients", []), "instructions": parsed.get("instructions", []), "servings": parsed.get("servings", 0), "prep_time_minutes": parsed.get("prep_time_minutes", 0), "cook_time_minutes": parsed.get("cook_time_minutes", 0), "allergens": parsed.get("allergens", []), "calories_kcal": parsed.get("calories_kcal", 0), "difficulty": parsed.get("difficulty", 1), "cuisine": parsed.get("cuisine", "OTHER")})
print(output)
`;
}

export async function getVideoDetails(
  videoId: string
): Promise<{ title: string; channelTitle: string }> {
  try {
    const url = `https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`;
    const response = await fetch(url);

    if (!response.ok) {
      return { title: "Untitled Recipe", channelTitle: "" };
    }

    const data = await response.json();
    return {
      title: data.title ?? "Untitled Recipe",
      channelTitle: data.author_name ?? "",
    };
  } catch {
    return { title: "Untitled Recipe", channelTitle: "" };
  }
}
