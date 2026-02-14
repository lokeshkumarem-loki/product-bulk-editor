import { Banner, Page } from "@shopify/polaris";
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
import { useEffect, useState } from "react";
import { Toast, Frame } from "@shopify/polaris";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const variantData = JSON.parse(formData.get("variants") || "[]");

    if (!variantData.length) {
      return {
        success: false,
        error: "No variants provided",
      };
    }

    const variantsByProduct = variantData.reduce((acc, item) => {
      const productId = item.productId;
      if (!acc[productId]) {
        acc[productId] = [];
      }
      acc[productId].push(item.variant);
      return acc;
    }, {});

    let totalUpdated = 0;
    let totalErrors = 0;
    const errors = [];

    for (const [productId, variants] of Object.entries(variantsByProduct)) {
      try {
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
                price: v.price,
                compareAtPrice: v.compareAtPrice || null,
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
      message: `Successfully removed discount price from ${totalUpdated} variant${totalUpdated > 1 ? "s" : ""}`,
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
          variantId: variant.id,
        },
        {
          $set: {
            price: Number(variant.price) || 0,
            compareAtPrice: variant.compareAtPrice
              ? Number(variant.compareAtPrice)
              : null,
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
      .filter((v) => v.compareAtPrice && v.compareAtPrice > 0)
      .map((v) => ({
        id: v.variantId,
        variantId: v.variantId,
        productId: v.productId,
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
        withDiscount: variantsData.length,
      },
    };
  } catch (error) {
    return {
      variantsData: [],
      storeCurrencyCode: "USD",
      stats: { total: 0, withDiscount: 0 },
      error: error.message,
    };
  }
}

/**
 * Component
 */
export default function RemoveDiscountPricePage() {
  const { variantsData, stats, error, storeCurrencyCode } = useLoaderData();
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  // Check if form is submitting
  const isSubmitting = navigation.state === "submitting";

  // Toast state
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  // Selection cleared state - to trigger VariantsTable to clear selection
  const [shouldClearSelection, setShouldClearSelection] = useState(false);

  // Handle action response
  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        setToastMessage(actionData.message);
        setToastError(false);
        setToastActive(true);

        // ✅ Trigger selection clearing
        setShouldClearSelection(true);

        // Revalidate data after short delay
        setTimeout(() => {
          revalidator.revalidate();
          // Reset clear selection flag after revalidation
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

  const handleSubmitRemoveDiscountPrice = (selectedProducts) => {
    if (!selectedProducts || selectedProducts.length === 0) {
      setToastMessage("Please select at least one variant");
      setToastError(true);
      setToastActive(true);
      return;
    }

    const variants = selectedProducts.map((p) => ({
      productId: p.productId,
      variant: {
        id: p.id || p.variantId,
        price: String(p.compareAtPrice),
        compareAtPrice: null,
      },
    }));

    const formData = new FormData();
    formData.append("actionType", "remove_discount");
    formData.append("variants", JSON.stringify(variants));

    submit(formData, { method: "post" });
  };

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
        title="Remove Discount Price"
        subtitle={
          stats
            ? `${stats.withDiscount} of ${stats.total} variants have discount pricing`
            : undefined
        }
        fullWidth
      >
        {error && (
          <Banner tone="critical" title="Error loading variants">
            <p>{error}</p>
          </Banner>
        )}
        <div style={{ marginBottom: "18px" }}>
          <VariantsTable
            currencyCode={storeCurrencySymbol}
            variantsData={variantsData}
            handleSubmit={handleSubmitRemoveDiscountPrice}
            isLoading={isSubmitting}
            clearSelection={shouldClearSelection}
            actionType="remove"
          />
        </div>
        {toastMarkup}
      </Page>
    </Frame>
  );
}
