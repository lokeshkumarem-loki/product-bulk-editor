import {
  ProductCollection,
  VariantCollection,
  MetafieldCollection,
} from "../db/model.js";

export const storeAndSyncData = async (
  shop,
  products = [],
  variants = [],
  metafields = [],
) => {
  try {
    const productCollection = await ProductCollection();
    const variantCollection = await VariantCollection();
    const metafieldCollection = await MetafieldCollection();

    if (products.length) {
      const productOps = products.map((p) => {
        const firstImage = p.productImage || "";

        return {
          updateOne: {
            filter: { shop, productId: p.id },
            update: {
              $set: {
                shop,
                productId: p.id,
                handle: p.handle ?? null,
                title: p.title ?? null,
                vendor: p.vendor ?? null,
                status: p.status ?? null,
                productImage: firstImage,
                productType: p.productType ?? null,
                tags: Array.isArray(p.tags) ? p.tags : [],
                category: p.category ?? null,
                collections: Array.isArray(p.collections)
                  ? p.collections.map((c) => ({
                      id: c.id ?? null,
                      title: c.title ?? null,
                      handle: c.handle ?? null,
                    }))
                  : [],
                createdAt: p.createdAt
                  ? new Date(p.createdAt).toLocaleString()
                  : null,
                updatedAt: p.updatedAt
                  ? new Date(p.updatedAt).toLocaleString()
                  : null,
                syncedAt: new Date().toLocaleString(),
              },
            },
            upsert: true,
          },
        };
      });

      if (productOps.length) {
        await productCollection.bulkWrite(productOps, {
          ordered: false,
        });
      }
    }

    if (variants.length) {
      const variantOps = variants.map((v) => ({
        updateOne: {
          filter: {
            shop,
            variantId: v.id,
          },
          update: {
            $set: {
              shop,
              vendor: v.vendor ?? null,
              status: v.status ?? null,
              variantId: v.id,
              productId: v.productId ?? null,
              variantTitle: v.title ?? null,
              productTitle: v.productTitle ?? null,
              productType: v.productType ?? null,
              tags: Array.isArray(v.tags) ? v.tags : [],
              price: v.price !== undefined ? Number(v.price) : null,
              category: v.category ?? null,
              collections: Array.isArray(v.collections)
                ? v.collections.map((c) => ({
                    id: c.id ?? null,
                    title: c.title ?? null,
                    handle: c.handle ?? null,
                  }))
                : [],
              compareAtPrice:
                v.compareAtPrice !== undefined
                  ? Number(v.compareAtPrice)
                  : null,
              image: v.image?.url ?? "",
              syncedAt: new Date().toLocaleString(),
            },
          },
          upsert: true,
        },
      }));

      if (variantOps.length) {
        await variantCollection.bulkWrite(variantOps, {
          ordered: false,
        });
      }
    }

    if (metafields.length) {
      const metafieldOps = metafields
        .filter((mf) => mf && mf.key)
        .map((mf) => ({
          updateOne: {
            filter: {
              shop,
              namespace: mf.namespace,
              key: mf.key,
            },
            update: {
              $set: {
                shop,
                name: mf.name ?? null,
                namespace: mf.namespace ?? null,
                key: mf.key,
                type: mf.type ?? null,
                ownerType: mf.ownerType ?? "PRODUCT",
                syncedAt: new Date().toLocaleString(),
              },
            },
            upsert: true,
          },
        }));

      if (metafieldOps.length > 0) {
        await metafieldCollection.bulkWrite(metafieldOps, {
          ordered: false,
        });
      }
    }

    return true;
  } catch (error) {
    console.error("❌ Error in storeAndSyncData:", error);
    throw error;
  }
};
