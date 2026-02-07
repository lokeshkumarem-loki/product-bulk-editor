// =====================================================
// tagMutation.js - WITH PROGRESS TRACKING & BATCHING
// =====================================================

// Single product update mutation
export const PRODUCT_UPDATE_MUTATION = (stagedUploadPath) => `
mutation {
  bulkOperationRunMutation(
    mutation: """
      mutation productUpdate($input: ProductInput!) {
        productUpdate(input: $input) {
          product {
            id
            tags
          }
          userErrors {
            field
            message
          }
        }
      }
    """,
    stagedUploadPath: "${stagedUploadPath}"
  ) {
    bulkOperation {
      id
      status
    }
    userErrors {
      message
    }
  }
}
`;

// Build tag updates for products
export function buildTagsJsonl(allRows, selectedIds, tag, action) {
  const trimmedTag = (tag || "").trim();
  if (!trimmedTag) return null;

  const updates = [];

  selectedIds.forEach((id) => {
    const product = allRows.find((r) => r.id === id);
    if (!product) return;

    const currentTags = Array.isArray(product.tags) ? product.tags : [];
    let newTags;

    if (action === "add") {
      const already = currentTags.some(
        (t) => t.toLowerCase() === trimmedTag.toLowerCase(),
      );
      newTags = already ? currentTags : [...currentTags, trimmedTag];
    } else if (action === "remove") {
      newTags = currentTags.filter(
        (t) => t.toLowerCase() !== trimmedTag.toLowerCase(),
      );
    } else {
      return;
    }

    // Only add if there's a change
    if (JSON.stringify(currentTags.sort()) !== JSON.stringify(newTags.sort())) {
      updates.push({
        id,
        tags: newTags,
        originalTags: currentTags,
      });
    }
  });

  return updates;
}

// =====================================================
// executeBulkTagUpdate - WITH PROGRESS CALLBACKS
// =====================================================
// Executes tag updates in controlled batches with:
//   • Progress tracking via callbacks
//   • Automatic rate limit handling
//   • Retry logic for failed mutations
//   • Detailed error reporting
// =====================================================
export async function executeBulkTagUpdate(admin, updates, onProgress = null) {
  if (!updates || updates.length === 0) {
    return {
      successful: 0,
      failed: 0,
      errors: [],
      totalTime: 0,
    };
  }

  const startTime = Date.now();
  const results = {
    successful: 0,
    failed: 0,
    errors: [],
    totalTime: 0,
  };

  // Batch configuration
  const BATCH_SIZE = 10; // Products per batch
  const BATCH_DELAY = 500; // ms between batches
  const RETRY_DELAY = 1000; // ms before retry
  const MAX_RETRIES = 2; // Max retries per product

  const totalBatches = Math.ceil(updates.length / BATCH_SIZE);

  // Process in batches
  for (let batchIndex = 0; batchIndex < totalBatches; batchIndex++) {
    const batchStart = batchIndex * BATCH_SIZE;
    const batch = updates.slice(batchStart, batchStart + BATCH_SIZE);

    console.log(
      `Processing batch ${batchIndex + 1}/${totalBatches} (${batch.length} products)`,
    );

    // Report progress
    if (onProgress) {
      onProgress({
        currentBatch: batchIndex + 1,
        totalBatches,
        processedCount: batchStart,
        totalCount: updates.length,
        progress: Math.round((batchStart / updates.length) * 100),
      });
    }

    // Execute batch in parallel
    const batchPromises = batch.map(async (update) => {
      let lastError = null;

      // Retry loop
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        try {
          const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
            variables: {
              input: {
                id: update.id,
                tags: update.tags,
              },
            },
          });

          const data = await response.json();

          // Check for GraphQL errors
          if (data.errors) {
            lastError = data.errors[0]?.message || "Unknown GraphQL error";

            // Check if it's a rate limit error
            if (lastError.includes("Throttled") || lastError.includes("rate")) {
              console.warn(
                `Rate limited on attempt ${attempt + 1}, retrying...`,
              );
              await new Promise((resolve) =>
                setTimeout(resolve, RETRY_DELAY * (attempt + 1)),
              );
              continue; // Retry
            }

            break; // Don't retry other errors
          }

          // Check for user errors
          const userErrors = data.data?.productUpdate?.userErrors;
          if (userErrors && userErrors.length > 0) {
            lastError = userErrors[0].message;
            break; // Don't retry user errors
          }

          // Success!
          results.successful++;
          return { success: true, id: update.id };
        } catch (error) {
          lastError = error.message;
          console.error(
            `Error updating product ${update.id} (attempt ${attempt + 1}):`,
            error,
          );

          // Retry on network errors
          if (attempt < MAX_RETRIES) {
            await new Promise((resolve) =>
              setTimeout(resolve, RETRY_DELAY * (attempt + 1)),
            );
            continue;
          }
        }
      }

      // All retries failed
      results.failed++;
      results.errors.push({
        id: update.id,
        error: lastError || "Unknown error after retries",
      });
      return { success: false, id: update.id, error: lastError };
    });

    // Wait for batch to complete
    await Promise.all(batchPromises);

    // Report batch completion
    if (onProgress) {
      onProgress({
        currentBatch: batchIndex + 1,
        totalBatches,
        processedCount: Math.min(batchStart + BATCH_SIZE, updates.length),
        totalCount: updates.length,
        progress: Math.round(
          ((batchStart + BATCH_SIZE) / updates.length) * 100,
        ),
      });
    }

    // Delay between batches (except for the last one)
    if (batchIndex < totalBatches - 1) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY));
    }
  }

  // Final progress update
  if (onProgress) {
    onProgress({
      currentBatch: totalBatches,
      totalBatches,
      processedCount: updates.length,
      totalCount: updates.length,
      progress: 100,
      completed: true,
    });
  }

  results.totalTime = Date.now() - startTime;

  console.log(`✓ Bulk update completed in ${results.totalTime}ms:`);
  console.log(`  Successful: ${results.successful}`);
  console.log(`  Failed: ${results.failed}`);

  return results;
}

// Default export
export default {
  buildTagsJsonl,
  executeBulkTagUpdate,
  PRODUCT_UPDATE_MUTATION,
};
