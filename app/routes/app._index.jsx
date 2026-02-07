import {
  Page,
  Card,
  Text,
  Button,
  Icon,
  InlineStack,
  BlockStack,
  Spinner,
  ProgressBar,
  Modal,
  Banner,
} from "@shopify/polaris";
import {
  UploadIcon,
  FilterIcon,
  ProductIcon,
  PriceListIcon,
  EditIcon,
  VariantIcon,
} from "@shopify/polaris-icons";
import {
  FETCH_METAFIELDS,
  FETCH_PRODUCTS,
  FETCH_VARIANTS,
  getQueryStatus,
} from "./queries/productQueries.jsx";
import { authenticate } from "../shopify.server.js";
import { storeAndSyncData } from "./server/services/storeAndSync.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLoaderData, replace } from "react-router";
import { ensureBulkFinishWebhook } from "./actions/webHooksInit.js";

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const url = new URL(request.url);
    const step = url.searchParams.get("step");
    const operationId = url.searchParams.get("operationId");

    await ensureBulkFinishWebhook(admin, process.env.APP_URL);
    if (operationId) {
      const statusRes = await admin.graphql(getQueryStatus(operationId));
      const statusJson = await statusRes.json();
      const bulk = statusJson.data?.node;

      if (!bulk) {
        return { status: "ERROR", error: "Invalid operation ID" };
      }

      console.log("Bulk operation status:", bulk.status);

      if (bulk.status !== "COMPLETED") {
        return {
          status: bulk.status,
          step,
          objectCount: bulk.objectCount || 0,
        };
      }

      if (!bulk.url) {
        return { status: "ERROR", error: "No bulk URL returned" };
      }

      console.log("Fetching bulk data from:", bulk.url);
      const file = await fetch(bulk.url);
      const text = await file.text();

      const rows = text
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (e) {
            console.error("Failed to parse line:", e);
            return null;
          }
        })
        .filter(Boolean);

      console.log(`Parsed ${rows.length} rows for step: ${step}`);

      // ================= STEP HANDLERS =================
      if (step === "PRODUCTS") {
        // Filter only products (not nested data)
        const products = rows.filter(
          (r) => r.id?.includes("Product") && !r.__parentId,
        );

        console.log(`Found ${products.length} products to store`);
        console.log("Sample product:", JSON.stringify(products[0], null, 2));

        await storeAndSyncData(shop, products, [], []);

        return {
          nextStep: "VARIANTS",
          status: "STEP_COMPLETED",
          count: products.length,
        };
      }

      if (step === "VARIANTS") {
        // Filter only variants
        const variants = rows
          .filter((r) => r.id?.includes("ProductVariant"))
          .map((v) => ({
            ...v,
            productId: v.__parentId, // Add productId from __parentId
          }));

        console.log(`Found ${variants.length} variants to store`);
        console.log("Sample variant:", JSON.stringify(variants[0], null, 2));

        await storeAndSyncData(shop, [], variants, []);

        return {
          nextStep: "METAFIELDS",
          status: "STEP_COMPLETED",
          count: variants.length,
        };
      }

      if (step === "METAFIELDS") {
        // Map metafields with proper structure
        const metafields = rows.map((mf) => ({
          ...mf,
          ownerId: mf.__parentId,
          ownerType: mf.__parentId?.includes("Variant") ? "VARIANT" : "PRODUCT",
        }));

        console.log(`Found ${metafields.length} metafields to store`);
        console.log(
          "Sample metafield:",
          JSON.stringify(metafields[0], null, 2),
        );

        await storeAndSyncData(shop, [], [], metafields);

        return {
          status: "DONE",
          count: metafields.length,
        };
      }

      return { status: "ERROR", error: `Unknown step: ${step}` };
    }

    // ================= START NEW OPERATION =================
    if (!step) return { status: "IDLE" };

    let mutation;
    if (step === "PRODUCTS") mutation = FETCH_PRODUCTS;
    else if (step === "VARIANTS") mutation = FETCH_VARIANTS;
    else if (step === "METAFIELDS") mutation = FETCH_METAFIELDS;
    else return { status: "ERROR", error: `Invalid step: ${step}` };

    console.log(`Starting bulk operation for step: ${step}`);

    const startRes = await admin.graphql(mutation);
    const startJson = await startRes.json();

    console.log("Start response:", JSON.stringify(startJson, null, 2));

    // Check for errors
    if (startJson.errors) {
      console.error("GraphQL errors:", startJson.errors);
      return {
        status: "ERROR",
        error: `GraphQL Error: ${startJson.errors[0]?.message || "Unknown error"}`,
      };
    }

    // Check for user errors
    if (startJson.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
      const userError = startJson.data.bulkOperationRunQuery.userErrors[0];
      console.error("User error:", userError);
      return {
        status: "ERROR",
        error: `${userError.field}: ${userError.message}`,
      };
    }

    const operationIdResult =
      startJson.data?.bulkOperationRunQuery?.bulkOperation?.id;
    if (!operationIdResult) {
      return { status: "ERROR", error: "No operation ID returned" };
    }

    console.log("Operation started successfully:", operationIdResult);

    return {
      status: "STARTED",
      step,
      operationId: operationIdResult,
    };
  } catch (error) {
    console.error("Loader error:", error);
    return {
      status: "ERROR",
      error: error.message ?? "Unexpected error",
      stack: error.stack,
    };
  }
}

export default function Index() {
  const navigate = useNavigate();
  const loaderData = useLoaderData();
  const [modalActive, setModalActive] = useState(false);
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(null);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState("");
  const [error, setError] = useState(null);
  const [currentOperationId, setCurrentOperationId] = useState(null);
  const [itemCount, setItemCount] = useState(0);
  const pollingTimeoutRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  // Polling function with better control
  const pollStatus = useCallback(
    (operationId, currentStep) => {
      if (!loading) {
        console.log("Polling stopped - loading is false");
        return;
      }
      console.log("Polling status for:", { operationId, currentStep });
      navigate(`?operationId=${operationId}&step=${currentStep}`);
    },
    [loading, navigate],
  );

  // Handle loader data updates
  useEffect(() => {
    if (!loaderData) return;

    console.log("=== Loader data received ===", loaderData);

    // Clear any existing polling timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Handle errors
    if (loaderData.status === "ERROR") {
      console.error("Error received:", loaderData.error);
      setError(loaderData.error || "An error occurred");
      setStatusText("Sync failed");
      setLoading(false);
      return;
    }

    // Handle operation started
    if (loaderData.status === "STARTED") {
      console.log("Operation started:", loaderData.operationId);
      setCurrentOperationId(loaderData.operationId);
      setStatusText(`Started syncing ${loaderData.step.toLowerCase()}...`);

      // Start polling after 2 seconds
      pollingTimeoutRef.current = setTimeout(() => {
        pollStatus(loaderData.operationId, loaderData.step);
      }, 2000);
    }

    // Handle in-progress statuses (RUNNING, CREATED, etc.)
    if (
      loaderData.status === "RUNNING" ||
      loaderData.status === "CREATED" ||
      loaderData.status === "CANCELING"
    ) {
      const objectCount = loaderData.objectCount || 0;
      setStatusText(
        `Syncing ${step?.toLowerCase() || "data"}... (${objectCount} items processed)`,
      );

      // Continue polling every 3 seconds
      pollingTimeoutRef.current = setTimeout(() => {
        pollStatus(currentOperationId, step);
      }, 3000);
    }

    // Handle step completed
    if (loaderData.status === "STEP_COMPLETED") {
      const count = loaderData.count || 0;
      setItemCount((prev) => prev + count);

      if (loaderData.nextStep === "VARIANTS") {
        setProgress(33);
        setStatusText(`${count} products synced! Now syncing variants...`);
        pollingTimeoutRef.current = setTimeout(
          () => startSync("VARIANTS"),
          1000,
        );
      } else if (loaderData.nextStep === "METAFIELDS") {
        setProgress(66);
        setStatusText(`${count} variants synced! Now syncing metafields...`);
        pollingTimeoutRef.current = setTimeout(
          () => startSync("METAFIELDS"),
          1000,
        );
      }
    }

    // Handle completion
    if (loaderData.status === "DONE") {
      const count = loaderData.count || 0;
      const totalCount = itemCount + count;
      setItemCount(totalCount);
      setProgress(100);
      setStatusText(
        `Sync completed successfully! ${totalCount} items synced 🎉`,
      );
      setLoading(false);

      pollingTimeoutRef.current = setTimeout(() => {
        setModalActive(false);
        // Reset state after modal closes
        setTimeout(() => {
          setProgress(0);
          setStep(null);
          setItemCount(0);
          setCurrentOperationId(null);
        }, 500);
      }, 2000);
    }

    // Handle canceled
    if (loaderData.status === "CANCELED") {
      setError("Sync was canceled");
      setStatusText("Sync canceled");
      setLoading(false);
    }

    // Handle failed
    if (loaderData.status === "FAILED") {
      setError("Bulk operation failed");
      setStatusText("Sync failed");
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData]);

  /* ================= START SYNC ================= */
  function startSync(currentStep) {
    console.log("=== Starting sync ===", currentStep);
    setLoading(true);
    setStep(currentStep);
    setStatusText(`Starting ${currentStep.toLowerCase()} sync...`);
    setModalActive(true);
    setError(null);

    if (currentStep === "PRODUCTS") {
      setProgress(0);
      setItemCount(0);
    }

    // Clear any existing timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Use navigate to load data
    navigate(`?step=${currentStep}`);
  }
  const clearUrlParams = () => {
    navigate(
      {
        pathname: "/app",
        search: "",
      },
      { replace: true },
    );
  };
  const handleModalClose = () => {
    if (!loading) {
      console.log("Modal closed");
      setModalActive(false);
      setError(null);
      setProgress(0);
      setStep(null);
      setItemCount(0);
      setCurrentOperationId(null);

      // Clear any polling timeout
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      clearUrlParams();
    }
  };

  const handleCancelSync = () => {
    console.log("Sync cancelled by user");
    setLoading(false);
    setStatusText("Cancelling sync...");

    // Clear polling timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }
  };

  return (
    <Page fullWidth>
      <BlockStack gap="500">
        {/* ERROR BANNER */}
        {error && !modalActive && (
          <Banner tone="critical" onDismiss={() => setError(null)}>
            <Text as="p">{error}</Text>
          </Banner>
        )}

        {/* HERO CARD */}
        <Card padding="500">
          <BlockStack gap="300">
            <Text variant="headingLg">Bulk Product Editor</Text>

            <Text tone="subdued">
              Sync products, variants, and metafields from Shopify and manage
              them efficiently using bulk actions.
            </Text>

            <Button
              fullWidth
              variant="primary"
              onClick={() => startSync("PRODUCTS")}
              icon={UploadIcon}
            >
              {loading ? "Syncing..." : "Start Sync"}
            </Button>
          </BlockStack>
        </Card>

        {/* HOW IT WORKS */}
        <BlockStack gap="200">
          <Text variant="headingMd">How it works</Text>
          <Text tone="subdued">
            Data is synced step-by-step to ensure reliability and accuracy.
          </Text>
        </BlockStack>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "12px",
          }}
        >
          <StepCard
            icon={UploadIcon}
            title="Sync Products"
            desc="Fetch products and variants from your store."
          />

          <StepCard
            icon={VariantIcon}
            title="Sync Variants"
            desc="Fetch and store all variant-level information."
          />

          <StepCard
            icon={EditIcon}
            title="Sync Metafields"
            desc="Store product and variant metafields efficiently."
          />

          <StepCard
            icon={FilterIcon}
            title="Apply Filters"
            desc="Filter synced data for bulk actions and edits."
          />

          <StepCard
            icon={ProductIcon}
            title="Bulk Edit"
            desc="Update tags, prices, and metafields in bulk."
          />

          <StepCard
            icon={PriceListIcon}
            title="Price Automation"
            desc="Manage discounts and compare-at prices easily."
          />
        </div>

        {/* CTA */}
        <Card padding="500">
          <BlockStack gap="300">
            <Text variant="headingSm">Data-first bulk editing</Text>
            <Text tone="subdued">
              Your store data is synced safely before any bulk changes are
              applied.
            </Text>
          </BlockStack>
        </Card>
      </BlockStack>

      {/* SYNC MODAL */}
      <Modal
        open={modalActive}
        onClose={handleModalClose}
        title="Syncing Data"
        primaryAction={
          loading
            ? {
                content: "Cancel",
                onAction: handleCancelSync,
                destructive: true,
              }
            : {
                content: "Close",
                onAction: handleModalClose,
              }
        }
      >
        <Modal.Section>
          <BlockStack gap="400">
            {error ? (
              <Banner tone="critical">
                <Text as="p">{error}</Text>
              </Banner>
            ) : (
              <>
                <InlineStack gap="300" align="center">
                  {loading && <Spinner size="small" />}
                  <Text variant="bodyMd" as="p">
                    {statusText}
                  </Text>
                </InlineStack>

                <ProgressBar progress={progress} size="small" tone="primary" />

                <BlockStack gap="200">
                  <Text variant="bodySm" tone="subdued">
                    Progress: {progress}%
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Current Syncing: {step || "Initializing..."}
                  </Text>
                  {itemCount === 0 ? (
                    <Text variant="bodySm" tone="subdued">
                      Items start processing...
                    </Text>
                  ) : (
                    <Text variant="bodySm" tone="subdued">
                      Items synced: {itemCount}
                    </Text>
                  )}
                </BlockStack>
              </>
            )}
          </BlockStack>
        </Modal.Section>
      </Modal>
    </Page>
  );
}

/* ================= STEP CARD COMPONENT ================= */
function StepCard({ icon, title, desc }) {
  return (
    <Card padding="400">
      <InlineStack gap="300" align="start">
        <Icon source={icon} tone="base" />
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3">
            {title}
          </Text>
          <Text tone="subdued">{desc}</Text>
        </BlockStack>
      </InlineStack>
    </Card>
  );
}
