import {
  Banner,
  BlockStack,
  Modal,
  Page,
  Text,
  TextField,
  InlineStack,
  Spinner,
  ButtonGroup,
  Button as PolarisButton,
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
    const mode = formData.get("mode") || "fixed";
    const percentage = Number(formData.get("percentage") || 0);

    if (!variantData.length) {
      return { success: false, error: "No variants provided" };
    }

 
    const variantsByProduct = variantData.reduce((acc, item) => {
      const productId = item.productId;
      if (!acc[productId]) acc[productId] = [];

  
      const finalDiscountPrice =
        mode === "percentage"
          ? parseFloat(
              (item.price - (item.price * percentage) / 100).toFixed(2),
            )
          : discountPrice;

      acc[productId].push({
        id: item.id || item.variantId,
        variantId: item.variantId,
        price: item.price,
        discountPrice: finalDiscountPrice,
      });
      return acc;
    }, {});

    let totalUpdated = 0;
    let totalErrors = 0;
    const errors = [];

    for (const [productId, variants] of Object.entries(variantsByProduct)) {
      try {
        const invalidVariants = variants.filter(
          (v) => v.discountPrice >= v.price || v.discountPrice <= 0,
        );
        if (invalidVariants.length > 0) {
          throw new Error(
            `Computed discount price must be greater than 0 and less than original price`,
          );
        }

        const response = await admin.graphql(
          `#graphql
          mutation productVariantsBulkUpdate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkUpdate(productId: $productId, variants: $variants) {
              product { id }
              productVariants { id price compareAtPrice }
              userErrors { field message }
            }
          }`,
          {
            variables: {
              productId,
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
          totalUpdated += data?.productVariants?.length || 0;
          await updateLocalDB(
            shop,
            productId,
            variants.map((v) => v.id),
            variants,
          );
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
    return { success: false, error: error.message || "Something went wrong" };
  }
}

async function updateLocalDB(shop, productId, variantIds, variants) {
  try {
    const VariantCol = await VariantCollection();
    const updatePromises = variants.map((variant) =>
      VariantCol.updateOne(
        { shop, productId, variantId: variant.variantId },
        {
          $set: {
            price: Number(variant.discountPrice) || 0,
            compareAtPrice: Number(variant.price) || 0,
            syncedAt: new Date().toLocaleString(),
          },
        },
      ),
    );
    const results = await Promise.all(updatePromises);
    return { modified: results.reduce((sum, r) => sum + r.modifiedCount, 0) };
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
      .filter((v) => (Number(v.compareAtPrice) || 0) === 0)
      .map((v) => ({
        id: v.variantId,
        variantId: v.variantId,
        productId: v.productId,
        vendor: v.vendor || "—",
        category: v.category || "—",
        collections: Array.isArray(v.collections) ? v.collections : [],
        status: v.status || "—",
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
      stats: { total: variants.length, withoutDiscount: variantsData.length },
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
          setTimeout(() => setShouldClearSelection(false), 100);
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

  const handleSubmitDiscount = useCallback(
    (finalPrice, percentage, mode) => {
      if (mode === "percentage") {
      
        const variants = selectedProducts.map((p) => {
          const discounted = parseFloat(
            (p.price - (p.price * percentage) / 100).toFixed(2),
          );
          return {
            productId: p.productId,
            id: p.id || p.variantId,
            variantId: p.variantId,
            price: p.price,
            discountPrice: discounted,
          };
        });

        const formData = new FormData();
         formData.append("discountPrice", String(variants[0].discountPrice));
        formData.append("variants", JSON.stringify(variants));
     
        formData.append("mode", "percentage");
        formData.append("percentage", String(percentage));
        submit(formData, { method: "post" });
        return;
      }

   
      const price = Number(finalPrice);
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
      formData.append("mode", "fixed");
      submit(formData, { method: "post" });
    },
    [selectedProducts, submit],
  );

  const handleCloseModal = useCallback(() => {
    if (!isSubmitting) {
      setModalActive(false);
      setDiscountPrice("");
    }
  }, [isSubmitting]);

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
        {error && (
          <Banner tone="critical" title="Error loading variants">
            <p>{error}</p>
          </Banner>
        )}

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
          handleClose={handleCloseModal}
          handleSubmit={handleSubmitDiscount}
          isProcessing={isSubmitting}
          currencyCode={storeCurrencySymbol}
          selectedProducts={selectedProducts}
        />

        {toastActive && (
          <Toast
            content={toastMessage}
            onDismiss={() => setToastActive(false)}
            error={toastError}
            duration={5000}
          />
        )}
      </Page>
    </Frame>
  );
}



const AddDiscountModal = ({
  active,
  handleClose,
  handleSubmit,
  isProcessing,
  currencyCode,
  selectedProducts,
}) => {

  const [discountMode, setDiscountMode] = useState("fixed");
  const [inputValue, setInputValue] = useState("");

  const selectedCount = selectedProducts.length;
  const prices = selectedProducts.map((p) => p.price);
  const lowestPrice = prices.length ? Math.min(...prices) : 0;
  const highestPrice = prices.length ? Math.max(...prices) : 0;

  const computedPrice = (() => {
    const val = Number(inputValue);
    if (!val || val <= 0) return 0;
    if (discountMode === "fixed") return val;

    return parseFloat((lowestPrice - (lowestPrice * val) / 100).toFixed(2));
  })();


  const inputError = (() => {
    const val = Number(inputValue);
    if (!inputValue || val <= 0) return undefined;

    if (discountMode === "percentage") {
      if (val <= 0 || val >= 100) return "Percentage must be between 1 and 99";
      return undefined;
    }

    if (val >= lowestPrice)
      return `Must be less than ${currencyCode} ${lowestPrice.toFixed(2)} (lowest variant price)`;
    return undefined;
  })();

  const isValid = (() => {
    const val = Number(inputValue);
    if (!val || val <= 0 || inputError) return false;
    if (discountMode === "percentage") return val > 0 && val < 100;
    return val > 0 && val < lowestPrice;
  })();


  useEffect(() => {
    setInputValue("");
  }, [discountMode, active]);

  const onSubmit = () => {
    if (!isValid) return;
    const val = Number(inputValue);

    if (discountMode === "fixed") {
      handleSubmit(String(val));
    } else {

      handleSubmitPercentage(val);
    }
  };

  const handleSubmitPercentage = (percentage) => {
 
    handleSubmit(null, percentage, discountMode);
  };

  const previewVariant = selectedProducts[0];
  const previewOriginal = previewVariant?.price || 0;
  const previewNew =
    discountMode === "fixed"
      ? Number(inputValue) || 0
      : previewOriginal - (previewOriginal * (Number(inputValue) || 0)) / 100;
  const previewDiscount = previewOriginal - previewNew;
  const previewPct =
    previewOriginal > 0
      ? ((previewDiscount / previewOriginal) * 100).toFixed(1)
      : 0;

  return (
    <Modal
      open={active}
      onClose={handleClose}
      loading={isProcessing}
      title="Add Discount Price"
      primaryAction={{
        content: isProcessing ? "Adding..." : "Add Discount",
        onAction: onSubmit,
        disabled: !isValid || selectedCount === 0 || isProcessing,
        loading: isProcessing,
      }}
      secondaryActions={[
        { content: "Cancel", onAction: handleClose, disabled: isProcessing },
      ]}
    >
      <Modal.Section>
        <BlockStack gap="400">

          <Text variant="bodyMd" tone="subdued">
            Add a discount to{" "}
            <Text as="span" fontWeight="semibold">
              {selectedCount} variant{selectedCount > 1 ? "s" : ""}
            </Text>
          </Text>

      
          {selectedCount > 0 && (
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
                <InlineStack gap="400">
                  <Text variant="bodySm">
                    Lowest: {currencyCode} {lowestPrice.toFixed(2)}
                  </Text>
                  <Text variant="bodySm">
                    Highest: {currencyCode} {highestPrice.toFixed(2)}
                  </Text>
                </InlineStack>
              </BlockStack>
            </div>
          )}

    
          <BlockStack gap="200">
            <Text variant="bodyMd" fontWeight="semibold">
              Discount type
            </Text>
            <div style={{ display: "flex", gap: "8px" }}>
              <div
                onClick={() => !isProcessing && setDiscountMode("fixed")}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: `2px solid ${discountMode === "fixed" ? "#2563eb" : "#e1e3e5"}`,
                  backgroundColor:
                    discountMode === "fixed" ? "#eff6ff" : "#fff",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "center",
                }}
              >
                <BlockStack gap="100">
                  <Text
                    variant="bodyMd"
                    fontWeight="semibold"
                    tone={discountMode === "fixed" ? undefined : "subdued"}
                  >
                    {currencyCode} Fixed Price
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Set an exact sale price
                  </Text>
                </BlockStack>
              </div>

              <div
                onClick={() => !isProcessing && setDiscountMode("percentage")}
                style={{
                  flex: 1,
                  padding: "12px 16px",
                  borderRadius: "8px",
                  border: `2px solid ${discountMode === "percentage" ? "#2563eb" : "#e1e3e5"}`,
                  backgroundColor:
                    discountMode === "percentage" ? "#eff6ff" : "#fff",
                  cursor: isProcessing ? "not-allowed" : "pointer",
                  transition: "all 0.15s ease",
                  textAlign: "center",
                }}
              >
                <BlockStack gap="100">
                  <Text
                    variant="bodyMd"
                    fontWeight="semibold"
                    tone={discountMode === "percentage" ? undefined : "subdued"}
                  >
                    % Percentage Off
                  </Text>
                  <Text variant="bodySm" tone="subdued">
                    Deduct % from each price
                  </Text>
                </BlockStack>
              </div>
            </div>
          </BlockStack>

    
          {discountMode === "fixed" ? (
            <TextField
              label="Sale Price"
              type="number"
              value={inputValue}
              onChange={(v) => {
                if (Number(v) >= 0) setInputValue(v);
              }}
              placeholder={`e.g., ${lowestPrice > 10 ? (lowestPrice - 10).toFixed(2) : "50.00"}`}
              prefix={currencyCode}
              autoComplete="off"
              disabled={isProcessing}
              min="0.01"
              step="0.01"
              helpText={`Must be less than the lowest variant price (${currencyCode} ${lowestPrice.toFixed(2)})`}
              error={inputError}
            />
          ) : (
            <TextField
              label="Discount Percentage"
              type="number"
              value={inputValue}
              onChange={(v) => {
                const num = Number(v);
                if (num >= 0 && num <= 99) setInputValue(v);
              }}
              placeholder="e.g., 20"
              suffix="%"
              autoComplete="off"
              disabled={isProcessing}
              min="1"
              max="99"
              step="1"
              helpText="Each variant's price will be reduced by this percentage"
              error={inputError}
            />
          )}

          {/* ✅ Preview box
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
                  Preview — {previewVariant.productTitle}
                </Text>
                <InlineStack gap="400" blockAlign="center">
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      Original Price
                    </Text>
                    <Text variant="bodyMd" fontWeight="semibold" tone="subdued">
                      {currencyCode} {previewOriginal.toFixed(2)}
                    </Text>
                  </div>
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      Discount
                    </Text>
                    <Text variant="bodyMd" tone="critical">
                      -{currencyCode} {previewDiscount.toFixed(2)} ({previewPct}
                      %)
                    </Text>
                  </div>
                  <div>
                    <Text variant="bodySm" tone="subdued">
                      New Price
                    </Text>
                    <Text variant="bodyMd" fontWeight="bold" tone="success">
                      {currencyCode} {previewNew.toFixed(2)}
                    </Text>
                  </div>
                </InlineStack>

                {discountMode === "percentage" && selectedCount > 1 && (
                  <Text variant="bodySm" tone="subdued">
                    * Each variant gets its own price reduced by {inputValue}%
                  </Text>
                )}

                <Text variant="bodySm" tone="subdued">
                  Compare at price will be set to the original price
                </Text>
              </BlockStack>
            </div>
          )} */}

          {isValid && (
            <Text variant="bodySm" tone="success">
              ✓ {selectedCount} variant{selectedCount > 1 ? "s" : ""} will be
              discounted
              {discountMode === "percentage"
                ? ` by ${inputValue}%`
                : ` to ${currencyCode} ${Number(inputValue).toFixed(2)}`}
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};
