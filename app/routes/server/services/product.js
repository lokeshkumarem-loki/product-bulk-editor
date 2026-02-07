import { ProductCollection } from "../db/model";

export const getProductInDB = async (shop) => {
  if (!shop) {
    throw new Error("Shop id is required");
  }
  const productCollection = await ProductCollection();
  const products = await productCollection.find({ shop }).toArray();

  return products || [];
};

export const updateProductInDB = async (shop, product) => {
  if (!shop || !product?.id)
    throw new Error("Shop and product ID are required");

  const productCollection = await ProductCollection();

  await productCollection.updateOne(
    { shop, productId: product.id },
    {
      $set: {
        handle: product.handle || null,
        title: product.title || null,
        vendor: product.vendor || null,
        status: product.status || null,
        productType: product.productType || null,
        tags: Array.isArray(product.tags) ? product.tags : [],
        updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
        syncedAt: new Date(),
      },
    },
    { upsert: true },
  );
};
