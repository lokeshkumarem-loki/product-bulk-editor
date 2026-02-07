import fs from "fs";
import path from "path";
import { getProductInDB } from "../server/services/product";

export const jsonlConvert = async (records = [], tag) => {
  const safeIds = Array.isArray(records) ? records : [];
  const trimmedTag = (tag || "").trim();

  if (!trimmedTag) {
    throw new Error("Tag is required");
  }

  const localProducts = await getProductInDB();

  const processedProducts = safeIds
    .map((id) => {
      const product = localProducts.find((p) => String(p.id) === String(id));

      if (!product) return null;

      const currentTags = Array.isArray(product.tags) ? product.tags : [];
      if (currentTags.includes(trimmedTag)) return null;

      return {
        input: {
          id: product.id,
          tags: [...currentTags, trimmedTag],
        },
      };
    })
    .filter(Boolean);

  const content = processedProducts
    .map((row) => JSON.stringify(row))
    .join("\n");

  const dirPath = path.join(process.cwd(), "app", "routes", "jsonl");
  const filePath = path.join(dirPath, "productData.jsonl");

  if (!fs.existsSync(dirPath)) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  fs.writeFileSync(filePath, content, "utf8");

  return { filePath };
};
