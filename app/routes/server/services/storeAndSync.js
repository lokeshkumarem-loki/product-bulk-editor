  import {
    ProductCollection,
    StoreCollection,
    VariantCollection,
    MetafieldCollection,
  } from "../db/model";

  export const storeAndSyncData = async (
    shop,
    products = [],
    variants = [],
    metafields = [],
  ) => {
    if (!shop) throw new Error("Shop domain is required");

    const storeCollection = await StoreCollection();
    const productCollection = await ProductCollection();
    const variantCollection = await VariantCollection();
    const metafieldCollection = await MetafieldCollection();

    // Update store sync timestamp
    await storeCollection.updateOne(
      { shop },
      {
        $set: {
          shop,
          lastSyncAt: new Date().toLocaleTimeString(), // You can replace with local system time if needed
        },
      },
      { upsert: true },
    );

    /* ================= PRODUCTS ================= */
    if (products.length) {
      const productOps = products.map((p) => {
        const firstImage = p?.featuredImage?.url;

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
                productImage: firstImage ?? "",
                productType: p.productType ?? null,
                tags: Array.isArray(p.tags) ? p.tags : [],
                category: p.category?.name ?? null,
                collections: Array.isArray(p.collections?.edges)
                  ? p.collections.edges.map((c) => ({
                      id: c.node?.id ?? null,
                      title: c.node?.title ?? null,
                      handle: c.node?.handle ?? null,
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
        await productCollection.bulkWrite(productOps, { ordered: false });
      }
    }

    /* ================= VARIANTS ================= */
    if (variants.length) {
      const variantOps = variants.map((v) => ({
        updateOne: {
          filter: { shop, variantId: v.id },
          update: {
            $set: {
              shop,
              variantId: v.id,
              productId: v.productId ?? null,
              title: v.title ?? null,
              sku: v.sku ?? null,
              price: v.price !== undefined ? Number(v.price) : null,
              compareAtPrice:
                v.compareAtPrice !== undefined ? Number(v.compareAtPrice) : null,
              inventoryQuantity: v.inventoryQuantity ?? null,
              availableForSale: v.availableForSale ?? null,
              option1: v.option1 ?? null,
              option2: v.option2 ?? null,
              option3: v.option3 ?? null,
              image: v.image?.url ?? "",
              syncedAt: new Date().toLocaleString(),
            },
          },
          upsert: true,
        },
      }));

      if (variantOps.length) {
        await variantCollection.bulkWrite(variantOps, { ordered: false });
      }
    }

    /* ================= METAFIELDS ================= */
    if (metafields.length) {
      const metafieldOps = metafields
        .filter((mf) => mf?.key && mf?.ownerId && mf?.ownerType)
        .map((mf) => ({
          updateOne: {
            filter: {
              shop,
              ownerId: mf.ownerId,
              ownerType: mf.ownerType, // PRODUCT | VARIANT
              key: mf.key,
            },
            update: {
              $set: {
                shop,
                ownerId: mf.ownerId,
                ownerType: mf.ownerType,
                namespace: mf.namespace ?? null,
                key: mf.key ?? null,
                value: mf.value ?? null,
                type: mf.type ?? null,
                syncedAt: new Date().toLocaleString(),
              },
            },
            upsert: true,
          },
        }));

      if (metafieldOps.length) {
        await metafieldCollection.bulkWrite(metafieldOps, { ordered: false });
      }
    }

    return true;
  };
