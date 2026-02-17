import {
  Banner,
  BlockStack,
  Modal,
  Page,
  Text,
  TextField,
  InlineStack,
  Spinner,
} from "@shopify/polaris";
import { authenticate } from "../shopify.server";
import { StoreCollection, VariantCollection } from "./server/db/model";
import {
  useLoaderData,
  useSubmit,
  useActionData,
  useNavigation,
  useRevalidator,
} from "react-router";
import { VariantsTable } from "./components/VarientsTable";
import { useCallback, useEffect, useState } from "react";
import { Toast, Frame } from "@shopify/polaris";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const variantData = JSON.parse(formData.get("variants") || "[]");
    const discountPrice = Number(formData.get("discountPrice") || 0);

    if (!variantData.length) {
      return {
        success: false,
        error: "No variants provided",
      };
    }

    if (!discountPrice || discountPrice <= 0) {
      return {
        success: false,
        error: "Please enter a valid discount price greater than 0",
      };
    }

    // Group variants by product (same structure as Remove Discount)
    const variantsByProduct = variantData.reduce((acc, item) => {
      const productId = item.productId;
      if (!acc[productId]) {
        acc[productId] = [];
      }
      // Push the variant structure
      acc[productId].push({
        id: item.id || item.variantId,
        variantId: item.variantId,
        price: item.price,
        discountPrice: discountPrice, // Store the discount price
      });
      return acc;
    }, {});

    let totalUpdated = 0;
    let totalErrors = 0;
    const errors = [];

    for (const [productId, variants] of Object.entries(variantsByProduct)) {
      try {
        const invalidVariants = variants.filter(
          (v) => v.discountPrice >= v.price,
        );
        if (invalidVariants.length > 0) {
          throw new Error(
            `Discount price (${discountPrice}) must be less than original price for all variants`,
          );
        }

        const response = await admin.graphql(
          `#graphql
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              product {
                id
              }
              productVariants {
                id
                price
                compareAtPrice
              }
              userErrors {
                field
                message
              }
            }
          }`,
          {
            variables: {
              productId: productId,
              variants: variants.map((v) => ({
                id: v.id,
                price: String(v.discountPrice),
                compareAtPrice: String(v.price),
              })),
            },
          },
        );

        const json = await response.json();
        const data = json.data?.productVariantsBulkUpdate;

        if (data?.userErrors?.length > 0) {
          data.userErrors.forEach((err) => {
            errors.push(`${err.field}: ${err.message}`);
            totalErrors++;
          });
        } else {
          const updatedCount = data?.productVariants?.length || 0;
          totalUpdated += updatedCount;

          // Update local DB for this product's variants
          const variantIds = variants.map((v) => v.id);
          await updateLocalDB(shop, productId, variantIds, variants);
        }
      } catch (error) {
        errors.push(`Product ${productId}: ${error.message}`);
        totalErrors++;
      }
    }

    if (totalErrors > 0) {
      return {
        success: false,
        error: `Updated ${totalUpdated} variants, but ${totalErrors} failed. Errors: ${errors.join(", ")}`,
        partialSuccess: totalUpdated > 0,
        count: totalUpdated,
      };
    }

    return {
      success: true,
      message: `Successfully added discount price to ${totalUpdated} variant${totalUpdated > 1 ? "s" : ""}`,
      count: totalUpdated,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "Something went wrong",
    };
  }
}

async function updateLocalDB(shop, productId, variantIds, variants) {
  try {
    const VariantCol = await VariantCollection();

    const updatePromises = variants.map((variant) => {
      return VariantCol.updateOne(
        {
          shop,
          productId,
          variantId: variant.variantId,
        },
        {
          $set: {
            price: Number(variant.discountPrice) || 0,
            compareAtPrice: Number(variant.price) || 0,
            syncedAt: new Date().toLocaleString(),
          },
        },
      );
    });
    const results = await Promise.all(updatePromises);
    const modified = results.reduce((sum, r) => sum + r.modifiedCount, 0);
    return { modified };
  } catch (error) {
    console.error("❌ Failed to update local DB:", error);
    throw error;
  }
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const variantCol = await VariantCollection();
    const variants = await variantCol.find({ shop }).toArray();

    const variantsData = variants
      .filter((v) => {
        const compareAt = Number(v.compareAtPrice) || 0;
        return compareAt === 0;
      })
      .map((v) => ({
        id: v.variantId,
        variantId: v.variantId,
        productId: v.productId,
        vendor: v.vendor,
        category: v.category,
        collection: v.collections,
        status: v.status,
        productTitle: v.productTitle || "Untitled Product",
        variantTitle: v.variantTitle || "Default",
        productType: v.productType || "—",
        price: Number(v.price) || 0,
        compareAtPrice: Number(v.compareAtPrice) || 0,
        tags: Array.isArray(v.tags) ? v.tags : [],
        image: v.image || null,
        syncedAt: v.syncedAt,
      }));

    const Store = await StoreCollection();
    const store = await Store.findOne({ shop });
    const storeCurrencyCode = store?.currencyCode || "USD";

    return {
      variantsData,
      storeCurrencyCode,
      stats: {
        total: variants.length,
        withoutDiscount: variantsData.length,
      },
    };
  } catch (error) {
    return {
      variantsData: [],
      storeCurrencyCode: "USD",
      stats: { total: 0, withoutDiscount: 0 },
      error: error.message,
    };
  }
}

export default function AddDiscountPricePage() {
  const { variantsData, stats, error, storeCurrencyCode } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const isSubmitting = navigation.state === "submitting";
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);
  const [modalActive, setModalActive] = useState(false);
  const [discountPrice, setDiscountPrice] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);
  const [shouldClearSelection, setShouldClearSelection] = useState(false);

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        setToastMessage(actionData.message);
        setToastError(false);
        setToastActive(true);
        setModalActive(false);
        setDiscountPrice("");
        setSelectedProducts([]);
        setShouldClearSelection(true);

        setTimeout(() => {
          revalidator.revalidate();
          setTimeout(() => {
            setShouldClearSelection(false);
          }, 100);
        }, 1500);
      } else {
        setToastMessage(actionData.error || "An error occurred");
        setToastError(true);
        setToastActive(true);
      }
    }
  }, [actionData, revalidator]);

  const handleOpenModal = useCallback((selected) => {
    if (!selected || selected.length === 0) {
      setToastMessage("Please select at least one variant");
      setToastError(true);
      setToastActive(true);
      return;
    }
    setSelectedProducts(selected);
    setModalActive(true);
  }, []);

  const handleSubmitDiscount = useCallback(() => {
    const price = Number(discountPrice);

    if (!price || price <= 0) {
      setToastMessage("Please enter a valid discount price greater than 0");
      setToastError(true);
      setToastActive(true);
      return;
    }

    const invalidVariants = selectedProducts.filter((p) => price >= p.price);
    if (invalidVariants.length > 0) {
      setToastMessage(
        `Discount price must be less than the original price for all variants`,
      );
      setToastError(true);
      setToastActive(true);
      return;
    }

    const variants = selectedProducts.map((p) => ({
      productId: p.productId,
      id: p.id || p.variantId,
      variantId: p.variantId,
      price: p.price,
    }));

    const formData = new FormData();
    formData.append("discountPrice", String(price));
    formData.append("variants", JSON.stringify(variants));

    submit(formData, { method: "post" });
  }, [discountPrice, selectedProducts, submit]);

  const handleCloseModal = useCallback(() => {
    if (!isSubmitting) {
      setModalActive(false);
      setDiscountPrice("");
    }
  }, [isSubmitting]);

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      error={toastError}
      duration={5000}
    />
  ) : null;

  const currencyCodeToIcon = (code) => {
    const moneyMap = {
      USD: "$",
      EUR: "€",
      GBP: "£",
      JPY: "¥",
      INR: "₹",
      AUD: "A$",
      CAD: "C$",
      CHF: "Fr",
      CNY: "¥",
      SEK: "kr",
      NZD: "NZ$",
    };
    return moneyMap[code] || code;
  };

  const storeCurrencySymbol = currencyCodeToIcon(storeCurrencyCode);

  return (
    <Frame>
      <Page
        title="Add Discount Price"
        subtitle={
          stats
            ? `${stats.withoutDiscount} of ${stats.total} variants available for discount`
            : undefined
        }
        fullWidth
      >
        <div style={{ marginBottom: "12px" }}>
          <VariantsTable
            currencyCode={storeCurrencySymbol}
            variantsData={variantsData}
            handleSubmit={handleOpenModal}
            isLoading={isSubmitting}
            clearSelection={shouldClearSelection}
            actionType="add"
          />
        </div>
        <AddDiscountModal
          active={modalActive}
          discountPrice={discountPrice}
          setDiscountPrice={setDiscountPrice}
          selectedCount={selectedProducts.length}
          handleClose={handleCloseModal}
          handleSubmit={handleSubmitDiscount}
          isProcessing={isSubmitting}
          currencyCode={storeCurrencySymbol}
          selectedProducts={selectedProducts}
        />

        {toastMarkup}
      </Page>
    </Frame>
  );
}

const AddDiscountModal = ({
  active,
  discountPrice,
  setDiscountPrice,
  selectedCount,
  handleClose,
  handleSubmit,
  isProcessing,
  currencyCode,
  selectedProducts,
}) => {
  const previewVariant = selectedProducts[0];
  const price = Number(discountPrice) || 0;
  const originalPrice = previewVariant?.price || 0;
  const discountAmount = originalPrice - price;
  const discountPercentage =
    originalPrice > 0 ? ((discountAmount / originalPrice) * 100).toFixed(1) : 0;

  const isValid = price > 0 && price < originalPrice;

  const prices = selectedProducts.map((p) => p.price);
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);

  return (
    <Modal
      open={active}
      onClose={handleClose}
      loading={isProcessing}
      title="Add Discount Price"
      primaryAction={{
        content: isProcessing ? "Adding..." : "Add Discount",
        onAction: handleSubmit,
        disabled: !isValid || selectedCount === 0,
        loading: isProcessing,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleClose,
          disabled: isProcessing,
        },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">
          <Text variant="bodyMd" tone="subdued">
            Add a discount price to {selectedCount} selected variant
            {selectedCount > 1 ? "s" : ""}
          </Text>

          {selectedCount > 1 && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#f6f6f7",
                borderRadius: "8px",
              }}
            >
              <BlockStack gap="100">
                <Text variant="bodySm" fontWeight="semibold">
                  Selected variant price range:
                </Text>
                <Text variant="bodySm">
                  Lowest: {currencyCode} {lowestPrice.toFixed(2)}
                </Text>
                <Text variant="bodySm">
                  Highest: {currencyCode} {highestPrice.toFixed(2)}
                </Text>
              </BlockStack>
            </div>
          )}

          <TextField
            label="Discount Price"
            type="number"
            value={discountPrice}
            onChange={(value) => {
              if (Number(value) < 0) return;
              setDiscountPrice(value);
            }}
            placeholder={`e.g., ${lowestPrice > 10 ? (lowestPrice - 10).toFixed(2) : "50"}`}
            prefix={currencyCode}
            autoComplete="off"
            disabled={isProcessing}
            min="0.01"
            step="0.01"
            helpText={`Enter the new sale price (must be less than ${currencyCode} ${lowestPrice.toFixed(2)})`}
            error={
              price > 0 && price >= lowestPrice
                ? `Discount price must be less than ${currencyCode} ${lowestPrice.toFixed(2)}`
                : undefined
            }
          />

          {isValid && previewVariant && (
            <div
              style={{
                padding: "12px",
                backgroundColor: "#f0fdf4",
                borderRadius: "8px",
                border: "1px solid #86efac",
              }}
            >
              <BlockStack gap="200">
                <Text variant="headingSm" as="h3">
                  Preview ({previewVariant.productTitle})
                </Text>

                <InlineStack gap="400" blockAlign="center">
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      Original Price
                    </Text>
                    <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                      {currencyCode} {originalPrice.toFixed(2)}
                    </Text>
                  </div>

                  <div>
                    <Text variant="bodySm" tone="subdued">
                      Discount
                    </Text>
                    <Text variant="bodyMd" tone="critical">
                      -{currencyCode} {discountAmount.toFixed(2)} (
                      {discountPercentage}%)
                    </Text>
                  </div>

                  <div>
                    <Text variant="bodySm" tone="subdued">
                      New Price
                    </Text>
                    <Text variant="bodyMd" fontWeight="bold" tone="success">
                      {currencyCode} {price.toFixed(2)}
                    </Text>
                  </div>
                </InlineStack>

                <Text variant="bodySm" tone="subdued">
                  Compare at price will be set to {currencyCode}{" "}
                  {originalPrice.toFixed(2)}
                </Text>
              </BlockStack>
            </div>
          )}

          {price > 0 && isValid && (
            <Text variant="bodySm" tone="success">
              ✓ {selectedCount} variant{selectedCount > 1 ? "s" : ""} will be
              discounted to {currencyCode} {price.toFixed(2)}
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};
