import {
  Page,
  Card,
  IndexTable,
  Text,
  Badge,
  Thumbnail,
  EmptyState,
  BlockStack,
  IndexFilters,
  useSetIndexFiltersMode,
  ChoiceList,
  Modal,
  TextField,
  Select,
  LegacyStack,
  Banner,
  Toast,
  Frame,
  ProgressBar,
  InlineStack,
  Button,
  Pagination,
  Spinner,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getProductInDB } from "./server/services/product";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
} from "react-router";
import { useState, useCallback, useMemo, useEffect } from "react";
import { MetafieldCollection } from "./server/db/model";
import { ADDMETAFIELDQUERY } from "./queries/metafieldQueries";

const ITEMS_PER_PAGE = 50;

export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const productIds = JSON.parse(formData.get("productIds") || "[]");
    const namespace = formData.get("namespace");
    const key = formData.get("key");
    const value = formData.get("value");
    const type = formData.get("type");

    if (!namespace || !key) {
      return {
        success: false,
        error: "Namespace and key are required",
      };
    }

    if (actionType === "add" && !value) {
      return {
        success: false,
        error: "Value is required for add operation",
      };
    }

    if (!productIds || productIds.length === 0) {
      return {
        success: false,
        error: "No products selected",
      };
    }

    const formattedValue = formatMetafieldValue(value, type);
    let successCount = 0;
    let failedCount = 0;
    const errors = [];
    const BATCH_SIZE = 10;
    const totalBatches = Math.ceil(productIds.length / BATCH_SIZE);

    for (let i = 0; i < totalBatches; i++) {
      const batchStart = i * BATCH_SIZE;
      const batchEnd = Math.min(batchStart + BATCH_SIZE, productIds.length);
      const batch = productIds.slice(batchStart, batchEnd);

      const batchPromises = batch.map(async (ownerId) => {
        try {
          const response = await admin.graphql(ADDMETAFIELDQUERY, {
            variables: {
              ownerId,
              namespace,
              key,
              value: formattedValue,
              type,
            },
          });

          const result = await response.json();
          if (result.data?.metafieldsSet?.userErrors?.length > 0) {
            const userErrors = result.data.metafieldsSet.userErrors;
            return {
              success: false,
              productId: ownerId,
              errors: userErrors.map((e) => e.message).join(", "),
            };
          } else if (result.data?.metafieldsSet?.metafields?.length > 0) {
            return {
              success: true,
              productId: ownerId,
            };
          } else {
            return {
              success: false,
              productId: ownerId,
              errors: "Unknown error occurred",
            };
          }
        } catch (error) {
          return {
            success: false,
            productId: ownerId,
            errors: error.message,
          };
        }
      });

      const batchResults = await Promise.all(batchPromises);
      batchResults.forEach((result) => {
        if (result.success) {
          successCount++;
        } else {
          failedCount++;
          errors.push({
            productId: result.productId,
            errors: result.errors,
          });
        }
      });
    }

    if (successCount === 0) {
      return {
        success: false,
        error: `Failed to add metafields to all products. ${errors.length > 0 ? errors[0].errors : "Unknown error"}`,
      };
    }

    if (failedCount > 0) {
      return {
        success: true,
        message: `Added metafield to ${successCount} product${successCount === 1 ? "" : "s"}. ${failedCount} failed.`,
        partialSuccess: true,
      };
    }

    return {
      success: true,
      message: `Successfully added metafield to ${successCount} product${successCount === 1 ? "" : "s"}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "An unexpected error occurred",
    };
  }
}

function formatMetafieldValue(value, type) {
  if (!value) return "";
  const trimmedValue = value.trim();

  switch (type) {
    case "number_integer":
      const intVal = parseInt(trimmedValue, 10);
      return isNaN(intVal) ? trimmedValue : String(intVal);

    case "number_decimal":
    case "rating":
    case "weight":
    case "volume":
    case "dimension":
    case "money":
      const floatVal = parseFloat(trimmedValue);
      return isNaN(floatVal) ? trimmedValue : String(floatVal);

    case "boolean":
      return trimmedValue.toLowerCase() === "true" ? "true" : "false";

    case "json":
      try {
        const parsed = JSON.parse(trimmedValue);
        return JSON.stringify(parsed);
      } catch {
        return trimmedValue;
      }

    case "color":
      // Remove # if present, Shopify stores without #
      return trimmedValue.replace("#", "").toUpperCase();

    case "date_time":
      // ✅ FIX: Ensure datetime has seconds
      // Input: 2026-02-16T12:00 → Output: 2026-02-16T12:00:00
      if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(trimmedValue)) {
        return `${trimmedValue}:00`;
      }
      return trimmedValue;

    case "date":
    case "url":
    case "single_line_text_field":
    case "multi_line_text_field":
    case "rich_text_field":
    case "product_reference":
    case "variant_reference":
    case "collection_reference":
    case "page_reference":
    case "order_reference":
    case "customer_reference":
    case "company_reference":
    case "blog_reference":
    case "metaobject_reference":
    case "file_reference":
    default:
      return trimmedValue;
  }
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const [products, metafieldsCol] = await Promise.all([
      getProductInDB(shop),
      MetafieldCollection(),
    ]);

    const safeProducts = Array.isArray(products) ? products : [];

    const rows = safeProducts.map((p) => ({
      id: p.productId || p.id || p._id?.toString(),
      title: p.title || "Untitled Product",
      image: p.productImage || null,
      imageAlt: p.title || "Product image",
      status: p.status || "UNKNOWN",
      vendor: p.vendor || "—",
      productType: p.productType || "—",
      tags: Array.isArray(p.tags) ? p.tags : [],
      category: p.category || "—",
      collections: Array.isArray(p.collections) ? p.collections : [],
      handle: p.handle || "—",
    }));

    const metafields = await metafieldsCol.find({ shop }).toArray();

    const preProcessedMetafields = metafields.map((mf) => ({
      name: mf.name,
      namespace: mf.namespace,
      key: mf.key,
      type: mf.type ?? "single_line_text_field",
      ownerType: mf.ownerType,
    }));

    return { metafields: preProcessedMetafields, rows, error: null };
  } catch (error) {
    return { rows: [], metafields: [], error: error.message };
  }
}

export default function AddMetafield() {
  const { rows = [], error = null, metafields = [] } = useLoaderData() || {};
  const actionData = useActionData();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [metafieldModalActive, setMetafieldModalActive] = useState(false);
  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [collectionFilter, setCollectionFilter] = useState([]);
  const [sortSelected, setSortSelected] = useState(["title-asc"]);
  const [taggedWith, setTaggedWith] = useState("");

  const [currentPage, setCurrentPage] = useState(1);
  const [selectedResources, setSelectedResources] = useState([]);

  const { mode, setMode } = useSetIndexFiltersMode();

  useEffect(() => {
    if (actionData) {
      if (actionData.success) {
        setToastMessage(actionData.message);
        setToastError(actionData.partialSuccess || false);
        setToastActive(true);
        setMetafieldModalActive(false);
        setSelectedResources([]);
      } else {
        setToastMessage(actionData.error || "An error occurred");
        setToastError(true);
        setToastActive(true);
      }
    }
  }, [actionData]);

  const filterOptions = useMemo(() => {
    const statuses = [...new Set(rows.map((r) => r.status))].filter(
      (s) => s && s !== "—",
    );
    const vendors = [...new Set(rows.map((r) => r.vendor))].filter(
      (v) => v && v !== "—",
    );
    const types = [...new Set(rows.map((r) => r.productType))].filter(
      (t) => t && t !== "—",
    );
    const categories = [...new Set(rows.map((r) => r.category))].filter(
      (c) => c && c !== "—",
    );
    const collectionsMap = new Map();
    rows.forEach((r) => {
      r.collections.forEach((c) => {
        if (c.title && c.title !== "—") {
          collectionsMap.set(c.id || c.title, c);
        }
      });
    });
    return {
      statuses: statuses.map((s) => ({ label: capitalize(s), value: s })),
      vendors: vendors.map((v) => ({ label: v, value: v })),
      types: types.map((t) => ({ label: t, value: t })),
      categories: categories.map((c) => ({ label: c, value: c })),
      collections: Array.from(collectionsMap.values()).map((c) => ({
        label: c.title,
        value: c.id || c.title,
      })),
    };
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    let filtered = rows;

    if (queryValue) {
      const q = queryValue.toLowerCase();
      filtered = filtered.filter(
        (r) =>
          r.title?.toLowerCase().includes(q) ||
          r.vendor?.toLowerCase().includes(q) ||
          r.productType?.toLowerCase().includes(q) ||
          r.handle?.toLowerCase().includes(q),
      );
    }
    if (taggedWith) {
      const t = taggedWith.toLowerCase();
      filtered = filtered.filter((r) =>
        r.tags.some((tag) => tag.toLowerCase().includes(t)),
      );
    }
    if (statusFilter.length > 0) {
      filtered = filtered.filter((r) => statusFilter.includes(r.status));
    }
    if (vendorFilter.length > 0) {
      filtered = filtered.filter((r) => vendorFilter.includes(r.vendor));
    }
    if (typeFilter.length > 0) {
      filtered = filtered.filter((r) => typeFilter.includes(r.productType));
    }
    if (categoryFilter.length > 0) {
      filtered = filtered.filter((r) => categoryFilter.includes(r.category));
    }
    if (collectionFilter.length > 0) {
      filtered = filtered.filter((r) =>
        r.collections.some(
          (c) =>
            collectionFilter.includes(c.id) ||
            collectionFilter.includes(c.title),
        ),
      );
    }

    if (sortSelected.length > 0) {
      const [sortKey, dir] = sortSelected[0].split("-");
      const sortedFiltered = [...filtered];
      sortedFiltered.sort((a, b) => {
        let aV =
          sortKey === "collections"
            ? a.collections?.length || 0
            : a[sortKey] || "";
        let bV =
          sortKey === "collections"
            ? b.collections?.length || 0
            : b[sortKey] || "";

        if (typeof aV === "string" && typeof bV === "string") {
          aV = aV.toLowerCase();
          bV = bV.toLowerCase();
        }
        const comparison = aV > bV ? 1 : aV < bV ? -1 : 0;
        return dir === "asc" ? comparison : -comparison;
      });
      return sortedFiltered;
    }
    return filtered;
  }, [
    rows,
    queryValue,
    taggedWith,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
    sortSelected,
  ]);

  const totalPages = Math.ceil(filteredAndSortedRows.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRows = filteredAndSortedRows.slice(startIndex, endIndex);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    queryValue,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
  ]);

  const handleSelectionChange = useCallback(
    (selectionType, toggleType, selection) => {
      if (selectionType === "all") {
        setSelectedResources(
          selectedResources.length === filteredAndSortedRows.length
            ? []
            : filteredAndSortedRows.map((r) => r.id),
        );
      } else if (selectionType === "page") {
        const pageIds = paginatedRows.map((r) => r.id);
        if (toggleType) {
          const newSelections = [...selectedResources];
          pageIds.forEach((id) => {
            if (!selectedResources.includes(id)) {
              newSelections.push(id);
            }
          });
          setSelectedResources(newSelections);
        } else {
          setSelectedResources(
            selectedResources.filter((id) => !pageIds.includes(id)),
          );
        }
      } else if (selectionType === "single") {
        const id = selection;
        setSelectedResources((prev) =>
          prev.includes(id)
            ? prev.filter((selectedId) => selectedId !== id)
            : [...prev, id],
        );
      }
    },
    [filteredAndSortedRows, paginatedRows, selectedResources],
  );

  const handleSelectAllProducts = useCallback(() => {
    setSelectedResources(filteredAndSortedRows.map((r) => r.id));
  }, [filteredAndSortedRows]);

  useEffect(() => {
    setSelectedResources([]);
  }, [
    queryValue,
    taggedWith,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
  ]);

  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setTaggedWith("");
    setStatusFilter([]);
    setVendorFilter([]);
    setTypeFilter([]);
    setCategoryFilter([]);
    setCollectionFilter([]);
  }, []);

  const appliedFilters = useMemo(() => {
    const filters = [];
    if (statusFilter.length)
      filters.push({
        key: "status",
        label: disambiguateLabel("Status", statusFilter),
        onRemove: () => setStatusFilter([]),
      });

    if (vendorFilter.length)
      filters.push({
        key: "vendor",
        label: disambiguateLabel("Vendor", vendorFilter),
        onRemove: () => setVendorFilter([]),
      });

    if (typeFilter.length)
      filters.push({
        key: "type",
        label: disambiguateLabel("Type", typeFilter),
        onRemove: () => setTypeFilter([]),
      });

    if (categoryFilter.length)
      filters.push({
        key: "category",
        label: disambiguateLabel("Category", categoryFilter),
        onRemove: () => setCategoryFilter([]),
      });

    if (collectionFilter.length) {
      const names = filterOptions.collections
        .filter((c) => collectionFilter.includes(c.value))
        .map((c) => c.label);
      filters.push({
        key: "collection",
        label: disambiguateLabel("Collection", names),
        onRemove: () => setCollectionFilter([]),
      });
    }

    if (taggedWith)
      filters.push({
        key: "taggedWith",
        label: `Tagged with: ${taggedWith}`,
        onRemove: () => setTaggedWith(""),
      });

    return filters;
  }, [
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
    taggedWith,
    filterOptions.collections,
  ]);

  const filters = useMemo(
    () => [
      {
        key: "vendor",
        label: "Vendor",
        shortcut: true,
        filter: (
          <ChoiceList
            title="Vendor"
            titleHidden
            choices={filterOptions.vendors}
            selected={vendorFilter}
            onChange={setVendorFilter}
            allowMultiple
          />
        ),
      },
      {
        key: "type",
        label: "Type",
        shortcut: true,
        filter: (
          <ChoiceList
            title="Type"
            titleHidden
            choices={filterOptions.types}
            selected={typeFilter}
            onChange={setTypeFilter}
            allowMultiple
          />
        ),
      },
      {
        key: "status",
        label: "Status",
        shortcut: true,
        filter: (
          <ChoiceList
            title="Status"
            titleHidden
            choices={filterOptions.statuses}
            selected={statusFilter}
            onChange={setStatusFilter}
            allowMultiple
          />
        ),
      },
      {
        key: "collection",
        label: "Collection",
        shortcut: true,
        filter: (
          <ChoiceList
            title="Collection"
            titleHidden
            choices={filterOptions.collections}
            selected={collectionFilter}
            onChange={setCollectionFilter}
            allowMultiple
          />
        ),
      },
      {
        key: "category",
        label: "Category",
        filter: (
          <ChoiceList
            title="Category"
            titleHidden
            choices={filterOptions.categories}
            selected={categoryFilter}
            onChange={setCategoryFilter}
            allowMultiple
          />
        ),
      },
    ],
    [
      filterOptions,
      vendorFilter,
      typeFilter,
      statusFilter,
      collectionFilter,
      categoryFilter,
    ],
  );

  const rowMarkup = useMemo(
    () =>
      paginatedRows.map((row, index) => (
        <IndexTable.Row
          id={row.id}
          key={row.id}
          position={index}
          selected={selectedResources.includes(row.id)}
          disabled={isSubmitting}
        >
          <IndexTable.Cell>
            <InlineStack gap="300" blockAlign="center">
              {row.image ? (
                <Thumbnail source={row.image} alt={row.imageAlt} size="small" />
              ) : (
                <Thumbnail source={ImageIcon} alt="No image" size="small" />
              )}
              <Text variant="bodyMd" as="span" fontWeight="medium">
                {row.title}
              </Text>
            </InlineStack>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Badge tone={statusTone(row.status)}>
              {capitalize(row.status)}
            </Badge>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text variant="bodyMd" as="span">
              {row.vendor}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text variant="bodyMd" tone="subdued" as="span">
              {row.productType}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text variant="bodyMd" tone="subdued" as="span">
              {row.category}
            </Text>
          </IndexTable.Cell>
          <IndexTable.Cell>
            <Text variant="bodyMd" as="span">
              {row.collections.length}
            </Text>
          </IndexTable.Cell>
        </IndexTable.Row>
      )),
    [paginatedRows, selectedResources, isSubmitting],
  );

  const promotedBulkActions = useMemo(
    () => [
      {
        content: "Add Metafield",
        onAction: () => setMetafieldModalActive(true),
      },
    ],
    [],
  );

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      error={toastError}
      duration={5000}
    />
  ) : null;

  if (error) {
    return (
      <Page title="Add Metafield" fullWidth>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Error Loading Products
            </Text>
            <Text tone="critical" as="p">
              {error}
            </Text>
          </BlockStack>
        </Card>
      </Page>
    );
  }

  if (!rows || rows.length === 0) {
    return (
      <Page title="Add Metafield" fullWidth>
        <Card>
          <EmptyState
            heading="No Products Found"
            image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
          >
            <Text as="p" tone="subdued">
              Run a sync first to pull products into the database.
            </Text>
          </EmptyState>
        </Card>
      </Page>
    );
  }

  return (
    <Frame>
      <Page title="Add Metafield" fullWidth>
        <div style={{ marginBottom: "18px" }}>
          <Card padding="0">
            <div style={{ padding: "12px", borderBottom: "1px solid #E1E3E5" }}>
              <InlineStack gap="200" align="end" blockAlign="center">
                {selectedResources.length < filteredAndSortedRows.length && (
                  <Button
                    size="slim"
                    onClick={handleSelectAllProducts}
                    disabled={isSubmitting}
                  >
                    Select all {filteredAndSortedRows.length} product
                    {filteredAndSortedRows.length !== 1 ? "s" : ""}
                  </Button>
                )}
                {selectedResources.length === filteredAndSortedRows.length &&
                  filteredAndSortedRows.length > 0 && (
                    <Button
                      size="slim"
                      onClick={() => setSelectedResources([])}
                      disabled={isSubmitting}
                    >
                      Deselect all
                    </Button>
                  )}
              </InlineStack>
            </div>

            <IndexFilters
              sortOptions={[
                { label: "Title", value: "title-asc", directionLabel: "A-Z" },
                { label: "Title", value: "title-desc", directionLabel: "Z-A" },
                { label: "Vendor", value: "vendor-asc", directionLabel: "A-Z" },
                {
                  label: "Vendor",
                  value: "vendor-desc",
                  directionLabel: "Z-A",
                },
                {
                  label: "Type",
                  value: "productType-asc",
                  directionLabel: "A-Z",
                },
                {
                  label: "Type",
                  value: "productType-desc",
                  directionLabel: "Z-A",
                },
              ]}
              sortSelected={sortSelected}
              queryValue={queryValue}
              queryPlaceholder="Search all products"
              onQueryChange={setQueryValue}
              onQueryClear={() => setQueryValue("")}
              onSort={setSortSelected}
              filters={filters}
              appliedFilters={appliedFilters}
              onClearAll={handleClearAll}
              mode={mode}
              setMode={setMode}
              tabs={[
                {
                  id: "all-products",
                  content: `All (${rows.length})`,
                  accessibilityLabel: "All products",
                  panelID: "all-products-content",
                },
              ]}
              selected={0}
              canCreateNewView={false}
            />

            <IndexTable
              resourceName={{ singular: "product", plural: "products" }}
              itemCount={paginatedRows.length}
              selectedItemsCount={
                selectedResources.length === filteredAndSortedRows.length
                  ? "All"
                  : selectedResources.length
              }
              onSelectionChange={handleSelectionChange}
              headings={[
                { title: "Product" },
                { title: "Status" },
                { title: "Vendor" },
                { title: "Type" },
                { title: "Category" },
                { title: "Collections" },
              ]}
              hasZebraStriping
              promotedBulkActions={promotedBulkActions}
            >
              {rowMarkup}
            </IndexTable>

            {totalPages > 1 && (
              <div
                style={{
                  padding: "16px",
                  borderTop: "1px solid #E1E3E5",
                  display: "flex",
                  justifyContent: "center",
                }}
              >
                <Pagination
                  hasPrevious={currentPage > 1}
                  onPrevious={() => setCurrentPage(currentPage - 1)}
                  hasNext={currentPage < totalPages}
                  onNext={() => setCurrentPage(currentPage + 1)}
                  label={`Page ${currentPage} of ${totalPages}`}
                />
              </div>
            )}
          </Card>
        </div>

        <AddMetafieldModal
          selectedResources={selectedResources}
          active={metafieldModalActive}
          handleClose={() => setMetafieldModalActive(false)}
          isProcessing={isSubmitting}
          availableMetafields={metafields}
        />

        {toastMarkup}
      </Page>
    </Frame>
  );
}

function disambiguateLabel(key, value) {
  const values = Array.isArray(value) ? value : [value];
  return `${key}: ${values.map(capitalize).join(", ")}`;
}

function statusTone(status) {
  switch ((status || "").toUpperCase()) {
    case "ACTIVE":
      return "success";
    case "DRAFT":
      return "info";
    case "ARCHIVED":
      return "warning";
    default:
      return "default";
  }
}

function capitalize(str) {
  if (!str) return "Unknown";
  return str.charAt(0).toUpperCase() + str.slice(1).toLowerCase();
}

// ✅ DYNAMIC METAFIELD MODAL
function AddMetafieldModal({
  selectedResources = [],
  active,
  handleClose,
  isProcessing,
  availableMetafields = [],
}) {
  const submit = useSubmit();

  const [selectedMetafieldKey, setSelectedMetafieldKey] = useState("");
  const [value, setValue] = useState("");
  const [errors, setErrors] = useState({});

  const selectedMetafield = useMemo(() => {
    if (!selectedMetafieldKey) return null;
    return availableMetafields.find((mf) => mf.key === selectedMetafieldKey);
  }, [selectedMetafieldKey, availableMetafields]);

  const metafieldOptions = useMemo(() => {
    const options = [
      {
        label: "Select a metafield",
        value: "",
        disabled: true,
      },
    ];

    const grouped = availableMetafields.reduce((acc, mf) => {
      const ns = mf.namespace || "custom";
      if (!acc[ns]) acc[ns] = [];
      acc[ns].push(mf);
      return acc;
    }, {});

    Object.keys(grouped)
      .sort()
      .forEach((namespace) => {
        grouped[namespace].forEach((mf) => {
          options.push({
            label: `${mf.name || mf.key} (${namespace}.${mf.key})`,
            value: mf.key,
          });
        });
      });

    return options;
  }, [availableMetafields]);

  const validate = useCallback(() => {
    const newErrors = {};

    if (!selectedMetafieldKey) {
      newErrors.metafield = "Please select a metafield";
    }

    if (!value.trim()) {
      newErrors.value = "Value is required";
    } else if (selectedMetafield) {
      const validationError = validateMetafieldValue(
        value,
        selectedMetafield.type,
      );
      if (validationError) {
        newErrors.value = validationError;
      }
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  }, [selectedMetafieldKey, value, selectedMetafield]);

  const handleSubmit = useCallback(() => {
    if (!validate()) {
      return;
    }

    if (selectedResources.length === 0) {
      return;
    }

    const formData = new FormData();
    formData.append("actionType", "add");
    formData.append("productIds", JSON.stringify(selectedResources));
    formData.append("namespace", selectedMetafield.namespace);
    formData.append("key", selectedMetafield.key);
    formData.append("value", value.trim());
    formData.append("type", selectedMetafield.type);

    submit(formData, { method: "post" });

    setSelectedMetafieldKey("");
    setValue("");
    setErrors({});
  }, [selectedMetafield, value, selectedResources, validate, submit]);

  const handleModalClose = useCallback(() => {
    if (!isProcessing) {
      setSelectedMetafieldKey("");
      setValue("");
      setErrors({});
      handleClose();
    }
  }, [isProcessing, handleClose]);

  useEffect(() => {
    setValue("");
    setErrors({});
  }, [selectedMetafieldKey]);

  // ✅ DYNAMIC INPUT RENDERING
  const renderInputField = () => {
    if (!selectedMetafield) return null;

    const type = selectedMetafield.type;
    const commonProps = {
      value: value,
      onChange: setValue,
      disabled: isProcessing,
      error: errors.value,
      autoComplete: "off",
    };

    switch (type) {
      case "single_line_text_field":
        return (
          <TextField
            label="Metafield Value"
            {...commonProps}
            placeholder="Enter text..."
            helpText="Single line text field"
          />
        );

      case "multi_line_text_field":
        return (
          <TextField
            label="Metafield Value"
            {...commonProps}
            placeholder="Enter multiple lines of text..."
            helpText="Multi-line text field"
            multiline={4}
          />
        );

      case "rich_text_field":
        return (
          <TextField
            label="Metafield Value (HTML)"
            {...commonProps}
            placeholder="<p>Enter HTML content...</p>"
            helpText="Rich text field - HTML format"
            multiline={4}
          />
        );

      case "number_integer":
        return (
          <TextField
            label="Integer Value"
            {...commonProps}
            type="number"
            placeholder="42"
            helpText="Enter a whole number (e.g., 42)"
          />
        );

      case "number_decimal":
        return (
          <TextField
            label="Decimal Value"
            {...commonProps}
            type="number"
            step="0.01"
            placeholder="3.14"
            helpText="Enter a decimal number (e.g., 3.14)"
          />
        );

      case "money":
        return (
          <TextField
            label="Money Amount"
            {...commonProps}
            type="number"
            step="0.01"
            placeholder="99.99"
            helpText="Enter money amount (e.g., 99.99)"
            prefix="$"
          />
        );

      case "rating":
        return (
          <TextField
            label="Rating"
            {...commonProps}
            type="number"
            step="0.1"
            min="1"
            max="5"
            placeholder="4.5"
            helpText="Enter a rating from 1 to 5 (e.g., 4.5)"
          />
        );

      case "weight":
        return (
          <TextField
            label="Weight"
            {...commonProps}
            type="number"
            step="0.01"
            placeholder="2.5"
            helpText="Enter weight value (e.g., 2.5 kg)"
            suffix="kg"
          />
        );

      case "volume":
        return (
          <TextField
            label="Volume"
            {...commonProps}
            type="number"
            step="0.01"
            placeholder="500"
            helpText="Enter volume value (e.g., 500 ml)"
            suffix="ml"
          />
        );

      case "dimension":
        return (
          <TextField
            label="Dimension"
            {...commonProps}
            type="number"
            step="0.01"
            placeholder="10.5"
            helpText="Enter dimension value (e.g., 10.5 cm)"
            suffix="cm"
          />
        );

      case "date":
        return (
          <TextField
            label="Date"
            {...commonProps}
            type="date"
            placeholder="2026-02-16"
            helpText="Select or enter date in format: YYYY-MM-DD"
          />
        );

      case "date_time":
        return (
          <TextField
            label="Date & Time"
            {...commonProps}
            type="datetime-local"
            placeholder="2026-02-16T12:00"
            helpText="Select or enter date and time"
          />
        );

      case "boolean":
        return (
          <Select
            label="Boolean Value"
            options={[
              { label: "Select value", value: "", disabled: true },
              { label: "True", value: "true" },
              { label: "False", value: "false" },
            ]}
            value={value}
            onChange={setValue}
            disabled={isProcessing}
            error={errors.value}
            helpText="Select true or false"
          />
        );

      case "color":
        return (
          <BlockStack gap="200">
            <TextField
              label="Color (Hex)"
              {...commonProps}
              placeholder="FF5733"
              helpText="Enter hex color code without # (e.g., FF5733)"
            />
            {value && /^#?[0-9A-Fa-f]{6}$/.test(value) && (
              <div
                style={{
                  width: "100%",
                  height: "40px",
                  backgroundColor: value.startsWith("#") ? value : `#${value}`,
                  borderRadius: "8px",
                  border: "1px solid #e1e3e5",
                }}
                title={`Color preview: ${value}`}
              />
            )}
          </BlockStack>
        );

      case "url":
        return (
          <TextField
            label="URL"
            {...commonProps}
            type="url"
            placeholder="https://example.com"
            helpText="Enter a full URL (e.g., https://example.com)"
          />
        );

      case "json":
        return (
          <TextField
            label="JSON Data"
            {...commonProps}
            placeholder='{"key": "value", "number": 123}'
            helpText='Enter valid JSON (e.g., {"key": "value"})'
            multiline={6}
          />
        );

      case "product_reference":
      case "variant_reference":
      case "collection_reference":
      case "page_reference":
      case "order_reference":
      case "customer_reference":
      case "company_reference":
      case "blog_reference":
      case "metaobject_reference":
        const referenceType = type.replace("_reference", "");
        const capitalizedType =
          referenceType.charAt(0).toUpperCase() + referenceType.slice(1);
        return (
          <TextField
            label={`${capitalizedType} Reference`}
            {...commonProps}
            placeholder={`gid://shopify/${capitalizedType}/123456789`}
            helpText={`Enter ${referenceType} GID (e.g., gid://shopify/${capitalizedType}/123456789)`}
          />
        );

      case "file_reference":
        return (
          <BlockStack gap="300">
            <TextField
              label="File Reference (GID)"
              {...commonProps}
              placeholder="gid://shopify/MediaImage/123456789"
              helpText="Enter the Shopify file GID. You can find this in your Shopify admin under Settings → Files."
            />

            {/* Show validation status */}
            {value && value.startsWith("gid://shopify/") && (
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "#f0fdf4",
                  borderRadius: "8px",
                  border: "1px solid #86efac",
                }}
              >
                <Text variant="bodySm" tone="success">
                  ✓ Valid Shopify file GID
                </Text>
              </div>
            )}

            {value && !value.startsWith("gid://shopify/") && (
              <div
                style={{
                  padding: "12px",
                  backgroundColor: "#fff4e6",
                  borderRadius: "8px",
                  border: "1px solid #fbbf24",
                }}
              >
                <Text variant="bodySm" tone="warning">
                  ⚠ GID must start with "gid://shopify/"
                </Text>
              </div>
            )}

            {/* Instructions */}
            <Banner tone="info">
              <Text variant="bodySm" as="p">
                <strong>How to get a file GID:</strong>
              </Text>
              <Text variant="bodySm" as="p">
                1. Go to Shopify Admin → Settings → Files
              </Text>
              <Text variant="bodySm" as="p">
                2. Upload or select your file
              </Text>
              <Text variant="bodySm" as="p">
                3. Copy the file GID (starts with gid://shopify/)
              </Text>
            </Banner>
          </BlockStack>
        );

      default:
        return (
          <TextField
            label="Metafield Value"
            {...commonProps}
            placeholder="Enter value..."
            helpText={getValueHelpText(type)}
          />
        );
    }
  };

  return (
    <Modal
      open={active}
      onClose={handleModalClose}
      loading={isProcessing}
      title="Add Metafield to Products"
      primaryAction={{
        content: isProcessing ? "Adding..." : "Add Metafield",
        onAction: handleSubmit,
        disabled: selectedResources.length === 0 || isProcessing,
        loading: isProcessing,
      }}
      secondaryActions={[
        {
          content: "Cancel",
          onAction: handleModalClose,
          disabled: isProcessing,
        },
      ]}
    >
      <Modal.Section>
        <LegacyStack vertical spacing="loose">
          <Banner tone={selectedResources.length === 0 ? "warning" : "info"}>
            <Text variant="bodyMd" as="p">
              {selectedResources.length === 0
                ? "⚠️ No products selected. Please select products from the table first."
                : `✓ Adding metafield to ${selectedResources.length} selected product${selectedResources.length === 1 ? "" : "s"}`}
            </Text>
          </Banner>

          {availableMetafields.length === 0 && (
            <Banner tone="critical">
              <Text variant="bodyMd" as="p">
                No metafield definitions available. Please sync metafield
                definitions first.
              </Text>
            </Banner>
          )}

          <Select
            label="Metafield Definition"
            options={metafieldOptions}
            value={selectedMetafieldKey}
            onChange={setSelectedMetafieldKey}
            disabled={isProcessing || availableMetafields.length === 0}
            error={errors.metafield}
            helpText="Select from your store's metafield definitions"
          />

          {renderInputField()}

          {isProcessing && (
            <BlockStack gap="200">
              <Text variant="bodySm" as="p" tone="subdued">
                Processing {selectedResources.length} product
                {selectedResources.length === 1 ? "" : "s"}...
              </Text>
              <ProgressBar size="small" />
            </BlockStack>
          )}
        </LegacyStack>
      </Modal.Section>
    </Modal>
  );
}

function getValueHelpText(type) {
  const helpTexts = {
    number_integer: "Enter a whole number (e.g., 42)",
    number_decimal: "Enter a decimal number (e.g., 3.14)",
    date: "Format: YYYY-MM-DD (e.g., 2026-02-09)",
    date_time: "Format: YYYY-MM-DDTHH:MM:SS (e.g., 2026-02-09T12:00:00)",
    url: "Enter a full URL (e.g., https://example.com)",
    json: 'Enter valid JSON (e.g., {"key": "value"})',
    color: "Enter hex color (e.g., FF5733)",
    boolean: "Enter true or false",
    rating: "Enter a number from 1 to 5",
  };
  return helpTexts[type] || "Enter the metafield value";
}

function validateMetafieldValue(value, type) {
  if (!value.trim()) {
    return "Value is required";
  }

  const validators = {
    number_integer: (v) =>
      !/^-?\d+$/.test(v) ? "Must be a whole number" : null,
    number_decimal: (v) =>
      !/^-?\d+(\.\d+)?$/.test(v) ? "Must be a valid number" : null,
    date: (v) =>
      !/^\d{4}-\d{2}-\d{2}$/.test(v) ? "Must be in format YYYY-MM-DD" : null,
    date_time: (v) =>
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v)
        ? "Must be in format YYYY-MM-DDTHH:MM:SS"
        : null,
    url: (v) => {
      try {
        new URL(v);
        return null;
      } catch {
        return "Must be a valid URL";
      }
    },
    json: (v) => {
      try {
        JSON.parse(v);
        return null;
      } catch {
        return "Must be valid JSON";
      }
    },
    color: (v) =>
      !/^#?[0-9A-Fa-f]{6}$/.test(v)
        ? "Must be a valid hex color (e.g., FF5733)"
        : null,
    boolean: (v) =>
      v.toLowerCase() !== "true" && v.toLowerCase() !== "false"
        ? "Must be true or false"
        : null,
    rating: (v) => {
      const rating = parseFloat(v);
      return isNaN(rating) || rating < 1 || rating > 5
        ? "Must be a number from 1 to 5"
        : null;
    },
    file_reference: (v) =>
      !v.startsWith("gid://shopify/")
        ? "Must be a valid Shopify GID (e.g., gid://shopify/MediaImage/123456789)"
        : null,
    product_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    variant_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    collection_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    page_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    order_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    customer_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    company_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    blog_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
    metaobject_reference: (v) =>
      !v.startsWith("gid://shopify/") ? "Must be a valid Shopify GID" : null,
  };

  return validators[type] ? validators[type](value) : null;
}
