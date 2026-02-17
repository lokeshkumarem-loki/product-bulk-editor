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
  FETCH_PRODUCTS,
  FETCH_METAFIELD_DEFINITIONS,
  getQueryStatus,
} from "./queries/productQueries.jsx";
import { authenticate } from "../shopify.server.js";
import { storeAndSyncData } from "./server/services/storeAndSync.js";
import { useState, useEffect, useCallback, useRef } from "react";
import { useNavigate, useLoaderData } from "react-router";
import { StoreCollection } from "./server/db/model.js";
import { CURRENCY_CODE_QUERY } from "./queries/productQueries.jsx";

export async function loader({ request }) {
  try {
    const { admin, session } = await authenticate.admin(request);
    const shop = session.shop;

    const url = new URL(request.url);
    const step = url.searchParams.get("step");
    const operationId = url.searchParams.get("operationId");
    const storeCurrencyData = await admin.graphql(CURRENCY_CODE_QUERY);
    const storeCurrencyJson = await storeCurrencyData.json();
    const currencyCode = storeCurrencyJson.data.shop.currencyCode;

    const Store = await StoreCollection();

    await Store.findOneAndUpdate(
      { shop },
      {
        $set: {
          currencyCode,
        },
      },
      { upsert: true, new: true },
    );

    if (operationId) {
      const statusRes = await admin.graphql(getQueryStatus(operationId));
      const statusJson = await statusRes.json();
      const bulk = statusJson.data?.node;

      if (!bulk) {
        return { status: "ERROR", error: "Invalid operation ID" };
      }

      // Still running
      if (bulk.status !== "COMPLETED") {
        return {
          status: bulk.status,
          step,
          objectCount: bulk.objectCount || 0,
        };
      }

      // No URL means no results
      if (!bulk.url) {
        return {
          status: "ERROR",
          error: `No data found for ${step}. Your store might be empty.`,
        };
      }

      const file = await fetch(bulk.url);
      const text = await file.text();

      const rows = text
        .split("\n")
        .filter(Boolean)
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch (e) {
            return null;
          }
        })
        .filter(Boolean);

      if (step === "PRODUCTS") {
        const products = [];
        const variantMap = new Map();
        const collectionMap = new Map();

        rows.forEach((row) => {
          const id = row.id || "";

          if (id.includes("/Product/") && !row.__parentId) {
            products.push(row);
          }
          // Variant (child of product)
          else if (id.includes("/ProductVariant/")) {
            const productId = row.__parentId;
            if (!variantMap.has(productId)) {
              variantMap.set(productId, []);
            }
            variantMap.get(productId).push(row);
          }
          // Collection (child of product)
          else if (id.includes("/Collection/")) {
            const productId = row.__parentId;
            if (!collectionMap.has(productId)) {
              collectionMap.set(productId, []);
            }
            collectionMap.get(productId).push(row);
          }
        });

        const enrichedProducts = products.map((p) => {
          const productVariants = variantMap.get(p.id) || [];
          const productCollections = collectionMap.get(p.id) || [];

          const firstImage =
            p.featuredImage?.url ||
            productVariants.find((v) => v.image?.url)?.image?.url ||
            "";

          return {
            id: p.id,
            handle: p.handle ?? null,
            title: p.title ?? null,
            vendor: p.vendor ?? null,
            status: p.status ?? null,
            productImage: firstImage,
            productType: p.productType ?? null,
            tags: Array.isArray(p.tags) ? p.tags : [],
            category: p.category?.name ?? null,
            collections: productCollections.map((c) => ({
              id: c.id ?? null,
              title: c.title ?? null,
              handle: c.handle ?? null,
            })),
            createdAt: p.createdAt ?? null,
            updatedAt: p.updatedAt ?? null,
          };
        });

        // Extract all variants with product context
        const allVariants = [];
        products.forEach((product) => {
          const productVariants = variantMap.get(product.id) || [];
          const productCollections = collectionMap.get(product.id) || [];
          productVariants.forEach((v) => {
            allVariants.push({
              id: v.id,
              productId: product.id,
              title: v.title ?? null,
              productTitle: product.title ?? null,
              productType: product.productType ?? null,
              tags: Array.isArray(product.tags) ? product.tags : [],
              price: v.price ?? null,
              compareAtPrice: v.compareAtPrice ?? null,
              image: v.image ?? null,
              vendor: product.vendor ?? null,
              status: product.status ?? null,
              category: product.category?.name ?? null,
              collections: productCollections.map((c) => ({
                id: c.id ?? null,
                title: c.title ?? null,
                handle: c.handle ?? null,
              })),
            });
          });
        });

        await storeAndSyncData(shop, enrichedProducts, allVariants, []);

        return {
          nextStep: "METAFIELDS",
          status: "STEP_COMPLETED",
          count: enrichedProducts.length,
          variantCount: allVariants.length,
        };
      }

      if (step === "METAFIELDS") {
        const metafields = rows
          .filter((r) => r.id?.includes("/MetafieldDefinition/"))
          .map((mf) => ({
            name: mf.name ?? null,
            namespace: mf.namespace ?? null,
            key: mf.key ?? null,
            type: mf.type?.name ?? null,
            ownerType: "PRODUCT",
          }));

        if (metafields.length > 0) {
          await storeAndSyncData(shop, [], [], metafields);
        }

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
    if (step === "PRODUCTS") {
      mutation = FETCH_PRODUCTS;
    } else if (step === "METAFIELDS") {
      mutation = FETCH_METAFIELD_DEFINITIONS;
    } else {
      return { status: "ERROR", error: `Invalid step: ${step}` };
    }

    const startRes = await admin.graphql(mutation);
    const startJson = await startRes.json();

    if (startJson.errors) {
      return {
        status: "ERROR",
        error: `GraphQL Error: ${startJson.errors[0]?.message || "Unknown error"}`,
      };
    }

    if (startJson.data?.bulkOperationRunQuery?.userErrors?.length > 0) {
      const userError = startJson.data.bulkOperationRunQuery.userErrors[0];

      return {
        status: "ERROR",
        error: `${userError.field || "Error"}: ${userError.message}`,
      };
    }

    const operationIdResult =
      startJson.data?.bulkOperationRunQuery?.bulkOperation?.id;
    if (!operationIdResult) {
      return { status: "ERROR", error: "No operation ID returned" };
    }

    return {
      status: "STARTED",
      step,
      operationId: operationIdResult,
    };
  } catch (error) {
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
  const [variantCount, setVariantCount] = useState(0);
  const pollingTimeoutRef = useRef(null);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
      }
    };
  }, []);

  // Polling function
  const pollStatus = useCallback(
    (operationId, currentStep) => {
      if (!loading) {
        return;
      }
      navigate(`?operationId=${operationId}&step=${currentStep}`);
    },
    [loading, navigate],
  );

  // Handle loader data updates
  useEffect(() => {
    if (!loaderData) return;
    // Clear any existing polling timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Handle errors
    if (loaderData.status === "ERROR") {
      setError(loaderData.error || "An error occurred");
      setStatusText("Sync failed");
      setLoading(false);
      return;
    }

    // Handle operation started
    if (loaderData.status === "STARTED") {
      setCurrentOperationId(loaderData.operationId);
      setStatusText(`Starting syncing...`);

      // Start polling after 2 seconds
      pollingTimeoutRef.current = setTimeout(() => {
        pollStatus(loaderData.operationId, loaderData.step);
      }, 2000);
    }

    // Handle in-progress statuses
    if (
      loaderData.status === "RUNNING" ||
      loaderData.status === "CREATED" ||
      loaderData.status === "CANCELING"
    ) {
      setStatusText("Processing data....");

      // Continue polling every 3 seconds
      pollingTimeoutRef.current = setTimeout(() => {
        pollStatus(currentOperationId, step);
      }, 3000);
    }

    // Handle step completed
    if (loaderData.status === "STEP_COMPLETED") {
      const count = loaderData.count || 0;
      const vCount = loaderData.variantCount || 0;

      setItemCount((prev) => prev + count);
      setVariantCount((prev) => prev + vCount);

      if (loaderData.nextStep === "METAFIELDS") {
        setProgress(50);
        setStatusText(`Synced halfway...`);
        pollingTimeoutRef.current = setTimeout(
          () => startSync("METAFIELDS"),
          1000,
        );
      }
    }

    // Handle completion
    if (loaderData.status === "DONE") {
      const count = loaderData.count || 0;
      setItemCount((prev) => prev + count);
      setProgress(100);
      setStatusText(`🎉 Sync completed!`);
      setLoading(false);

      pollingTimeoutRef.current = setTimeout(() => {
        setModalActive(false);
        // Reset state after modal closes
        setTimeout(() => {
          setProgress(0);
          setStep(null);
          setItemCount(0);
          setVariantCount(0);
          setCurrentOperationId(null);
        }, 500);
      }, 3000);
    }

    // Handle canceled/failed
    if (loaderData.status === "CANCELED") {
      setError("Sync was canceled");
      setStatusText("Sync canceled");
      setLoading(false);
    }

    if (loaderData.status === "FAILED") {
      setError("Bulk operation failed");
      setStatusText("Sync failed");
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaderData]);

  /* ================= START SYNC ================= */
  function startSync(currentStep) {
    setLoading(true);
    setStep(currentStep);
    setStatusText(`Starting ${currentStep.toLowerCase()} sync...`);
    setModalActive(true);
    setError(null);

    if (currentStep === "PRODUCTS") {
      setProgress(0);
      setItemCount(0);
      setVariantCount(0);
    }

    // Clear any existing timeout
    if (pollingTimeoutRef.current) {
      clearTimeout(pollingTimeoutRef.current);
      pollingTimeoutRef.current = null;
    }

    // Navigate to trigger loader
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
      setModalActive(false);
      setError(null);
      setProgress(0);
      setStep(null);
      setItemCount(0);
      setVariantCount(0);
      setCurrentOperationId(null);

      // Clear polling timeout
      if (pollingTimeoutRef.current) {
        clearTimeout(pollingTimeoutRef.current);
        pollingTimeoutRef.current = null;
      }
      clearUrlParams();
    }
  };

  const handleCancelSync = () => {
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
              disabled={loading}
            >
              {loading ? "Syncing..." : "Start Sync"}
            </Button>
          </BlockStack>
        </Card>

        {/* HOW IT WORKS */}
        <BlockStack gap="200">
          <Text variant="headingMd">How it works</Text>
          <Text tone="subdued">
            Data is synced in two steps: products with variants, then metafield
            definitions.
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
            title="Sync Products & Variants"
            desc="Fetch all products and their variants in one query."
          />

          <StepCard
            icon={EditIcon}
            title="Sync Metafield Definitions"
            desc="Store product metafield schemas for bulk editing."
          />

          <StepCard
            icon={FilterIcon}
            title="Apply Filters"
            desc="Filter synced data for bulk actions and edits."
          />

          <StepCard
            icon={ProductIcon}
            title="Bulk Edit Tags"
            desc="Update tags across multiple products at once."
          />

          <StepCard
            icon={PriceListIcon}
            title="Price Management"
            desc="Manage prices and compare-at prices in bulk."
          />

          <StepCard
            icon={VariantIcon}
            title="Variant Updates"
            desc="Apply changes to specific variants across products."
          />
        </div>

        {/* CTA */}
        <Card padding="500">
          <BlockStack gap="300">
            <Text variant="headingSm">Data-first bulk editing</Text>
            <Text tone="subdued">
              Your store data is synced safely before any bulk changes are
              applied. Products and variants are fetched together for accuracy.
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
      <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
        <Icon source={icon} tone="base" />
        <BlockStack gap="100">
          <Text variant="headingSm" as="h3">
            {title}
          </Text>
          <Text tone="subdued">{desc}</Text>
        </BlockStack>
      </div>
    </Card>
  );
}
