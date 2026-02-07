import { ProductCollection } from "../db/model";

const FETCH_PRODUCT_BY_ID = (productId) => `
  query {
    product(id: "${productId}") {
      id
      title
      handle
      status
      vendor
      productType
      tags
      category {
        name
      }
      featuredImage {
        url
      }
      updatedAt
      collections(first: 10) {
        edges {
          node {
            id
            title
            handle
          }
        }
      }
    }
  }
`;

// =====================================================
// syncProductsAfterTagUpdate
// =====================================================
// After the bulkOperationRunMutation completes, call
// this to fetch fresh data from Shopify for each
// affected product and update the local DB.
//
// This ensures the UI immediately reflects the new tags
// without needing a full product sync.
// =====================================================
export async function syncProductsAfterTagUpdate(admin, shop, productIds) {
  if (!admin || !shop || !productIds || productIds.length === 0) {
    console.warn("syncProductsAfterTagUpdate: missing required params");
    return { success: false, synced: 0 };
  }

  const productCollection = await ProductCollection();
  let synced = 0;

  for (const productId of productIds) {
    try {
      // 1. Fetch fresh product data from Shopify
      const response = await admin.graphql(FETCH_PRODUCT_BY_ID(productId));
      const json = await response.json();

      if (json.errors) {
        console.error(`Failed to fetch product ${productId}:`, json.errors);
        continue;
      }

      const product = json.data?.product;
      if (!product) {
        console.warn(`Product ${productId} not found in Shopify`);
        continue;
      }

      // 2. Extract featured image
      const productImage = product.featuredImage?.url || "";

      // 3. Extract collections
      const collections = Array.isArray(product.collections?.edges)
        ? product.collections.edges.map((edge) => ({
            id: edge.node?.id || null,
            title: edge.node?.title || null,
            handle: edge.node?.handle || null,
          }))
        : [];

      // 4. Update local DB
      await productCollection.updateOne(
        { shop, productId: product.id },
        {
          $set: {
            shop,
            productId: product.id,
            handle: product.handle || null,
            title: product.title || null,
            vendor: product.vendor || null,
            status: product.status || null,
            productImage,
            productImageAlt: product.title || "",
            productType: product.productType || null,
            tags: Array.isArray(product.tags) ? product.tags : [],
            category: product.category?.name || null,
            collections,
            updatedAt: product.updatedAt ? new Date(product.updatedAt) : null,
            syncedAt: new Date(),
          },
        },
        { upsert: true },
      );

      synced++;
    } catch (error) {
      console.error(`Error syncing product ${productId}:`, error);
    }
  }

  console.log(`Synced ${synced}/${productIds.length} products to local DB`);
  return { success: true, synced };
}
