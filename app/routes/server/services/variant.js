import { VariantCollection } from "../db/model";

export const getVariantsByShop = async (shop) => {
  if (!shop) {
    throw new Error("Shop is required");
  }
  const variant = await VariantCollection();
  const variants = await variant.find({ shop }).toArray();
  return variants;
};
export const updateVariantInDB = async (shop, variant) => {
  if (!shop || !variant?.id || !variant?.productId)
    throw new Error("Shop, variant ID, and product ID required");

  const variantCollection = await VariantCollection();

  await variantCollection.updateOne(
    { shop, variantId: variant.id },
    {
      $set: {
        productId: variant.productId,
        title: variant.title || null,
        sku: variant.sku || null,
        price: variant.price !== undefined ? Number(variant.price) : null,
        compareAtPrice:
          variant.compareAtPrice !== undefined
            ? Number(variant.compareAtPrice)
            : null,
        inventoryQuantity:
          variant.inventoryQuantity !== undefined
            ? variant.inventoryQuantity
            : null,
        availableForSale:
          variant.availableForSale !== undefined
            ? variant.availableForSale
            : null,
        option1: variant.option1 || null,
        option2: variant.option2 || null,
        option3: variant.option3 || null,
        syncedAt: new Date(),
      },
    },
    { upsert: true },
  );
};
