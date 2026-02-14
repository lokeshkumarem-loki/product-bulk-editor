import { VariantCollection } from "../db/model";

const updateVariantsPrice = async (payload) => {
  const { shop, productId, variantIds } = payload;

  if (
    !shop ||
    !productId ||
    !Array.isArray(variantIds) ||
    variantIds.length === 0
  ) {
    throw new Error("Shop, productId, and variantIds are required");
  }

  try {
    const res = await VariantCollection.updateMany(
      {
        shop,
        productId,
        variantId: { $in: variantIds },
      },
      [
        {
          $set: {
            compareAtPrice: "$price",
            price: null,
          },
        },
      ],
    );

    return res;
  } catch (error) {
    console.error("❌ Failed to update variant prices:", error);
    throw error;
  }
};

export default updateVariantsPrice;
