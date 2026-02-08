import { Router } from "express";
import { getComposioClient } from "../lib/composio";

interface IngredientInput {
  name: string;
  quantity?: string;
}

interface InstacartRequestBody {
  title: string;
  ingredients: IngredientInput[];
  instructions?: string[];
  servings?: number;
  prepTimeMinutes?: number;
  cookTimeMinutes?: number;
  thumbnailUrl?: string;
  sourceUrl?: string;
}

function parseQuantity(
  str: string
): { quantity: number; unit: string } | null {
  const match = str.match(/^([\d./]+)\s*(.*)$/);
  if (!match) return null;

  let quantity: number;
  const raw = match[1];

  if (raw.includes("/")) {
    const [num, denom] = raw.split("/").map(Number);
    quantity = num / denom;
  } else {
    quantity = parseFloat(raw);
  }

  if (isNaN(quantity)) return null;

  let unit = match[2].trim().toLowerCase();

  const unitMap: Record<string, string> = {
    g: "g",
    gram: "g",
    grams: "g",
    kg: "kg",
    kilogram: "kg",
    oz: "oz",
    ounce: "oz",
    ounces: "oz",
    lb: "lb",
    lbs: "lb",
    pound: "lb",
    pounds: "lb",
    cup: "cup",
    cups: "cup",
    tbsp: "tbsp",
    tablespoon: "tbsp",
    tablespoons: "tbsp",
    tsp: "tsp",
    teaspoon: "tsp",
    teaspoons: "tsp",
    ml: "ml",
    l: "L",
    liter: "L",
    liters: "L",
  };

  unit = unitMap[unit] || unit || "each";

  return { quantity, unit };
}

const router = Router();

// POST /api/recipe/instacart
router.post("/instacart", async (req, res) => {
  try {
    const body: InstacartRequestBody = req.body;

    if (!body.title || !body.ingredients?.length) {
      res.status(400).json({ error: "Title and ingredients are required" });
      return;
    }

    const composio = getComposioClient();

    const ingredients = body.ingredients.map((ing) => {
      const result: {
        name: string;
        display_text?: string;
        quantity?: number;
        unit?: string;
      } = {
        name: ing.name,
      };

      if (ing.quantity) {
        result.display_text = `${ing.quantity} ${ing.name}`;
        const parsed = parseQuantity(ing.quantity);
        if (parsed) {
          result.quantity = parsed.quantity;
          result.unit = parsed.unit;
        }
      }

      return result;
    });

    const cookingTime =
      (body.prepTimeMinutes || 0) + (body.cookTimeMinutes || 0);

    const args: Record<string, unknown> = {
      title: body.title,
      ingredients,
      instructions: body.instructions || [],
    };

    if (body.servings) args.servings = body.servings;
    if (cookingTime > 0) args.cooking_time = cookingTime;
    if (body.thumbnailUrl) args.image_url = body.thumbnailUrl;
    args.expires_in = 30;
    if (body.sourceUrl) {
      args.landing_page_configuration = {
        partner_linkback_url: body.sourceUrl,
      };
    }

    const result = await composio.tools.execute("INSTACART_CREATE_RECIPE_PAGE", {
      custom_auth_params: {
        base_url: "https://connect.dev.instacart.tools",
        parameters: [],
      },
      arguments: args,
    });

    console.log(
      "Instacart recipe response:",
      JSON.stringify(result, null, 2)
    );

    const data = result.data as Record<string, unknown>;
    const url =
      (data?.url as string) ??
      (data?.products_link_url as string) ??
      (data?.data as Record<string, unknown>)?.url;

    if (!url || typeof url !== "string") {
      console.error("Instacart recipe response missing URL:", {
        fullResponse: result,
        data,
      });
      res.status(500).json({ error: "Instacart did not return a URL" });
      return;
    }

    res.json({ url });
  } catch (error) {
    console.error("Instacart recipe API error:", {
      error,
      message: error instanceof Error ? error.message : String(error),
    });

    const message =
      error instanceof Error
        ? error.message
        : "Failed to create Instacart link";

    if (message.includes("COMPOSIO_API_KEY")) {
      res.status(500).json({ error: "Instacart integration not configured" });
      return;
    }

    res.status(500).json({ error: "Failed to create Instacart link" });
  }
});

export default router;
