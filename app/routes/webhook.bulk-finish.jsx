// =====================================================
// app/routes/webhooks.bulkFinish.jsx
// =====================================================
// Handles BULK_OPERATIONS_FINISH webhook from Shopify
//
// Flow:
// 1. Bulk mutation completes → webhook fired
// 2. Check if it was a mutation or query
// 3. If mutation → trigger bulk query to re-fetch products
// 4. If query → download JSONL and update MongoDB
// =====================================================

import { authenticate } from "../shopify.server";
import { FETCH_ALL_PRODUCTS_BULK } from "../queries/productQueries";
import { syncProductsFromBulkResult } from "./server/services/syncAfterWebhook";

export const action = async ({ request }) => {
  try {
    const { topic, shop, session, admin, payload } =
      await authenticate.webhook(request);

    if (topic !== "BULK_OPERATIONS_FINISH") {
      return new Response("Ignored", { status: 200 });
    }

    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📬 BULK_OPERATIONS_FINISH WEBHOOK");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("Shop:", shop);
    console.log("Payload:", JSON.stringify(payload, null, 2));

    const bulkOperationId = payload.admin_graphql_api_id;
    const status = payload.status;
    const errorCode = payload.error_code;

    console.log("\nBulk Operation ID:", bulkOperationId);
    console.log("Status:", status);
    console.log("Error Code:", errorCode || "None");

    // Check if operation failed
    if (status !== "completed") {
      console.error(`❌ Bulk operation ${status}:`, errorCode);
      return new Response("Operation not completed", { status: 200 });
    }

    // Determine if this was a MUTATION or QUERY
    // We can check by looking at the operation type stored in metadata
    // For now, we'll use a simple heuristic: if there's a URL, it's likely a QUERY
    const hasResultUrl = !!payload.url;

    if (hasResultUrl) {
      // ═══════════════════════════════════════════
      // CASE 1: Bulk QUERY completed
      // → Download JSONL and sync to MongoDB
      // ═══════════════════════════════════════════
      console.log("\n📊 This was a BULK QUERY (has result URL)");
      console.log("Result URL:", payload.url);

      const result = await syncProductsFromBulkResult(payload.url, shop);

      console.log("\n✅ Webhook processing complete");
      console.log(`   Synced ${result.synced} products to database`);
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return new Response(
        JSON.stringify({
          success: true,
          type: "query",
          synced: result.synced,
          errors: result.errors,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } else {
      // ═══════════════════════════════════════════
      // CASE 2: Bulk MUTATION completed
      // → Trigger bulk QUERY to re-fetch all products
      // ═══════════════════════════════════════════
      console.log("\n🔄 This was a BULK MUTATION");
      console.log("Triggering bulk QUERY to re-fetch all products...");

      const queryRes = await admin.graphql(FETCH_ALL_PRODUCTS_BULK);
      const queryJson = await queryRes.json();

      if (queryJson.errors) {
        console.error("❌ Failed to trigger bulk query:", queryJson.errors);
        return new Response("Failed to trigger query", { status: 500 });
      }

      const userErrors = queryJson.data?.bulkOperationRunQuery?.userErrors;
      if (userErrors?.length > 0) {
        console.error("❌ Bulk query user errors:", userErrors);
        return new Response("Bulk query failed", { status: 500 });
      }

      const queryOperationId =
        queryJson.data?.bulkOperationRunQuery?.bulkOperation?.id;

      console.log("✓ Bulk query triggered successfully");
      console.log("  Query Operation ID:", queryOperationId);
      console.log(
        "  Status:",
        queryJson.data?.bulkOperationRunQuery?.bulkOperation?.status,
      );
      console.log(
        "\n⏳ Waiting for query to complete (will trigger another webhook)...",
      );
      console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

      return new Response(
        JSON.stringify({
          success: true,
          type: "mutation",
          queryOperationId,
        }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    }
  } catch (error) {
    console.error("\n❌ WEBHOOK ERROR:", error);
    console.error(error.stack);
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n");

    // Return 200 even on error to prevent Shopify from retrying
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }
};
