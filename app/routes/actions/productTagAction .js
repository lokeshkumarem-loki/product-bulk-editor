import { authenticate } from "../../shopify.server";
import { getProductInDB } from "../server/services/product";
import { syncProductsAfterTagUpdate } from "../server/services/syncServices";
import { buildTagsJsonl, executeBulkTagUpdate } from "../queries/tagMutation";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const tag = formData.get("tag");
    const products = JSON.parse(formData.get("products") || "[]");
    const productIds = products.map((p) => p.id);

    const localProducts = await getProductInDB(shop);
    const safeProducts = Array.isArray(localProducts) ? localProducts : [];

    const allRows = safeProducts.map((p) => ({
      id: p.productId || p.id || p._id?.toString(),
      tags: Array.isArray(p.tags) ? p.tags : [],
    }));

    const updates = buildTagsJsonl(allRows, productIds, tag, actionType);

    if (!updates || updates.length === 0) {
      return {
        success: true,
        message: "No changes needed - products already have the correct tags.",
        stats: {
          attempted: productIds.length,
          updated: 0,
          skipped: productIds.length,
        },
      };
    }

    // Track progress
    let progressData = {
      currentBatch: 0,
      totalBatches: 0,
      processedCount: 0,
      totalCount: updates.length,
      progress: 0,
    };

    const results = await executeBulkTagUpdate(admin, updates, (progress) => {
      progressData = progress;
    });

    // Handle complete failure
    if (results.failed > 0 && results.successful === 0) {
      const errorMsg = results.errors[0]?.error || "Unknown error";

      return {
        success: false,
        error: `Failed to update products. ${errorMsg}`,
        stats: {
          attempted: updates.length,
          successful: 0,
          failed: results.failed,
        },
      };
    }

    const syncResult = await syncProductsAfterTagUpdate(
      admin,
      shop,
      productIds,
    );

    const verb = actionType === "add" ? "added to" : "removed from";
    let message = `Tag "${tag.trim()}" ${verb} ${results.successful} product${results.successful === 1 ? "" : "s"}`;

    if (results.failed > 0) {
      message += `. ${results.failed} failed`;
    }

    if (productIds.length - updates.length > 0) {
      message += ` (${productIds.length - updates.length} already correct)`;
    }

    message += `. Synced ${syncResult.synced} to DB.`;

    return {
      success: true,
      message,
      stats: {
        attempted: productIds.length,
        updated: results.successful,
        failed: results.failed,
        skipped: productIds.length - updates.length,
        syncedToDB: syncResult.synced,
        timeMs: results.totalTime,
      },
      errors:
        results.errors.length > 0 ? results.errors.slice(0, 5) : undefined, // Return first 5 errors
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Unexpected error",
      stack: process.env.NODE_ENV === "development" ? error.stack : undefined,
    };
  }
}

// Example of the detailed response structure:
// {
//   success: true,
//   message: "Tag 'summer-sale' added to 245 products. 3 failed (2 already correct). Synced 250 to DB.",
//   stats: {
//     attempted: 250,
//     updated: 245,
//     failed: 3,
//     skipped: 2,
//     syncedToDB: 250,
//     timeMs: 12450
//   },
//   errors: [
//     { id: "gid://...", error: "Product not found" },
//     { id: "gid://...", error: "Throttled" }
//   ]
// }
