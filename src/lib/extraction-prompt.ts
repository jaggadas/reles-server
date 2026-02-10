/**
 * Shared recipe extraction prompt used by both Composio and Gemini providers.
 */

export const RECIPE_EXTRACTION_PROMPT_PREFIX = `You are a recipe extractor. Extract structured recipe information from this cooking video transcript.

Return ONLY a valid JSON object that strictly follows the schema below.

{
  "servings": 0,
  "prep_time_minutes": 0,
  "cook_time_minutes": 0,
  "ingredients": [
    { "name": "ingredient name", "quantity": "amount with unit or as needed" }
  ],
  "instructions": [
    "Step 1 text...",
    "Step 2 text..."
  ],
  "allergens": [],
  "calories_kcal": 0,
  "difficulty": 1,
  "cuisine": "OTHER",
  "accompanying_recipes": ["recipe name 1", "recipe name 2"],
  "highlights": ["short, catchy bullet 1", "bullet 2"]
}

Rules for servings:
- Return the number of servings the recipe makes
- If stated, use the stated value
- If not stated, infer a reasonable number based on portion size
- If it cannot be inferred, return 0

Rules for prep_time_minutes:
- Return prep time as a number in minutes
- Include washing, chopping, marinating, and setup time
- If stated, use it; if not, infer reasonably
- If it cannot be inferred, return 0

Rules for cook_time_minutes:
- Return cook time as a number in minutes
- Include active cooking and baking time
- Exclude resting or cooling time unless explicitly cooked
- If stated, use it; if not, infer reasonably
- If it cannot be inferred, return 0

Rules for ingredients:
- Include every ingredient mentioned
- Each ingredient must have name and quantity
- If no quantity is stated, use "as needed"

Rules for instructions:
- Extract chronological, step-by-step cooking actions
- Each step must be a single, clear sentence
- Combine closely related actions into one step
- Do NOT list ingredients inside instructions
- Do not include commentary, tips, or serving suggestions

Rules for allergens:
- Return a list of common food allergens present in the recipe
- Use lowercase strings only
- Allowed values: "dairy", "gluten", "eggs", "nuts", "peanuts", "soy", "shellfish", "fish", "sesame"
- If no allergens are present, return []

Rules for calories_kcal:
- Return estimated calories in kcal for the entire dish
- If mentioned, use the stated value
- If not mentioned, estimate based on ingredients and portion size
- If it cannot be reasonably inferred, return 0

Rules for difficulty:
- Return a number from 1 to 5
- 1 = very easy, 2 = easy, 3 = intermediate, 4 = advanced, 5 = expert
- Base on technique, equipment, and timing

Rules for cuisine:
- Select exactly ONE from: AMERICAN, ITALIAN, FRENCH, SPANISH, MEXICAN, BRAZILIAN, MEDITERRANEAN, MIDDLE_EASTERN, INDIAN, CHINESE, JAPANESE, KOREAN, THAI, VIETNAMESE, ASIAN_OTHER, AFRICAN, CARIBBEAN, LATIN_AMERICAN, EUROPEAN_OTHER, OTHER
- Choose the closest match based on ingredients, flavor profile, and technique

Rules for accompanying_recipes:
- Suggest 3-4 complementary recipes that pair well with this dish
- Consider side dishes, appetizers, accompaniments, and desserts that match the cuisine
- Each entry should be a short, searchable recipe name (2-4 words)
- If no good pairings can be inferred, return []

Rules for highlights:
- Return 0-4 short bullet points (strings) about what stands out in this recipe
- Focus on things like: very quick to make, one-pot meal, great for weeknights, good for meal prep, kid-friendly, high protein, etc.
- Avoid repeating obvious facts already captured by servings or times unless truly noteworthy
- Keep each highlight under 80 characters

Return ONLY valid JSON. No markdown, explanations, or extra text.

Transcript:
`;

export function buildExtractionPrompt(transcript: string): string {
  return RECIPE_EXTRACTION_PROMPT_PREFIX + transcript;
}
