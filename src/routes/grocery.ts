import { Router } from "express";
import { getComposioClient } from "../lib/composio";
import type { GroceryItem } from "../lib/types";

interface ParsedQuantity {
  quantity: number;
  unit: string;
}

function parseQuantityAndUnit(displayQuantity: string): ParsedQuantity {
  if (!displayQuantity) {
    return { quantity: 1, unit: "each" };
  }

  const normalized = displayQuantity.trim().toLowerCase();

  if (normalized === "as needed" || normalized === "to taste") {
    return { quantity: 1, unit: "as needed" };
  }

  const fractionMatch = displayQuantity.match(/^(\d+\/\d+|\d+\.\d+|\d+)\s*(.+)?$/);
  if (fractionMatch) {
    let quantity = 1;
    const quantityStr = fractionMatch[1];

    if (quantityStr.includes('/')) {
      const [num, denom] = quantityStr.split('/').map(Number);
      quantity = num / denom;
    } else {
      quantity = parseFloat(quantityStr);
    }

    let unit = fractionMatch[2]?.trim() || "each";
    unit = unit.split(',')[0].trim();

    return { quantity: Math.max(0.1, quantity), unit: unit || "each" };
  }

  return { quantity: 1, unit: displayQuantity };
}

const router = Router();

// POST /api/grocery/instacart
router.post("/instacart", async (req, res) => {
  try {
    const body = req.body;
    const items = body.items as GroceryItem[] | undefined;
    const title = body.title as string | undefined;

    if (!Array.isArray(items) || items.length === 0) {
      res.status(400).json({ error: "At least one grocery item is required" });
      return;
    }

    const composio = getComposioClient();

    const ingredients = items.map((item) => {
      const { quantity, unit } = parseQuantityAndUnit(item.displayQuantity);
      return {
        name: item.name,
        display_text: item.displayQuantity
          ? `${item.displayQuantity} ${item.name}`
          : item.name,
        quantity,
        unit,
      };
    });

    const result = await composio.tools.execute("INSTACART_CREATE_RECIPE_PAGE", {
      custom_auth_params: {
        base_url: "https://connect.dev.instacart.tools",
        parameters: [],
      },
      arguments: {
        title: title || "Grocery List",
        ingredients,
        expires_in: 30,
      },
    });

    console.log("Composio response:", JSON.stringify(result, null, 2));

    const data = result.data as Record<string, unknown>;
    const url =
      (data?.url as string) ??
      (data?.products_link_url as string) ??
      (data?.data as Record<string, unknown>)?.url;

    if (!url || typeof url !== "string") {
      console.error("Instacart response missing URL:", {
        fullResponse: result,
        data,
      });
      res.status(500).json({ error: "Instacart did not return a shareable URL" });
      return;
    }

    res.json({ url });
  } catch (error) {
    console.error("Instacart API error:", {
      error,
      message: error instanceof Error ? error.message : "Unknown error",
    });

    const message =
      error instanceof Error ? error.message : "Failed to create Instacart list";

    if (message.includes("COMPOSIO_API_KEY")) {
      res.status(500).json({ error: "Instacart integration not configured" });
      return;
    }

    res.status(500).json({ error: "Failed to create Instacart list" });
  }
});

export default router;
