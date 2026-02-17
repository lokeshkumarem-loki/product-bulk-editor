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
  Button,
  Frame,
  TextField,
  Toast,
  Banner,
  InlineStack,
  Spinner,
  Combobox,
  Listbox,
  Pagination,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getProductInDB } from "./server/services/product";
import { ProductCollection } from "./server/db/model";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
  useRevalidator,
} from "react-router";
import { useState, useCallback, useMemo, useEffect } from "react";

const ITEMS_PER_PAGE = 50;

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const tag = formData.get("tag");
    const products = JSON.parse(formData.get("products") || "[]");

    if (!products.length) {
      return { success: false, error: "No products selected" };
    }

    const PRODUCT_UPDATE_MUTATION = `
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
    `;

    let successCount = 0;
    let errorCount = 0;
    const errors = [];

    const BATCH_SIZE = 10;
    for (let i = 0; i < products.length; i += BATCH_SIZE) {
      const batch = products.slice(i, i + BATCH_SIZE);

      const batchPromises = batch.map(async (product) => {
        try {
          let updatedTags;
          if (actionType === "add") {
            updatedTags = product.tags.includes(tag)
              ? product.tags
              : [...product.tags, tag];
          } else {
            updatedTags = product.tags.filter((t) => t !== tag);
          }

          const response = await admin.graphql(PRODUCT_UPDATE_MUTATION, {
            variables: {
              input: {
                id: product.id,
                tags: updatedTags,
              },
            },
          });

          const json = await response.json();

          if (json.data?.productUpdate?.userErrors?.length > 0) {
            const error = json.data.productUpdate.userErrors[0];
            throw new Error(`${error.field}: ${error.message}`);
          }

          successCount++;
          await updateLocalDB(shop, product.id, updatedTags);

          return { success: true, productId: product.id };
        } catch (error) {
          errorCount++;
          errors.push(`${product.id}: ${error.message}`);
          return {
            success: false,
            productId: product.id,
            error: error.message,
          };
        }
      });

      await Promise.all(batchPromises);

      if (i + BATCH_SIZE < products.length) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    if (errorCount > 0) {
      return {
        success: false,
        partialSuccess: successCount > 0,
        message: `Updated ${successCount} products, but ${errorCount} failed`,
        error: errors.slice(0, 3).join(", ") + (errors.length > 3 ? "..." : ""),
        count: successCount,
      };
    }

    return {
      success: true,
      message: `Successfully ${actionType === "add" ? "added" : "removed"} tag "${tag}" ${actionType === "add" ? "to" : "from"} ${successCount} product${successCount > 1 ? "s" : ""}`,
      count: successCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || "An unexpected error occurred",
    };
  }
}

async function updateLocalDB(shop, productId, tags) {
  try {
    const ProductCol = await ProductCollection();
    await ProductCol.updateOne(
      { shop, productId },
      {
        $set: {
          tags: tags,
          syncedAt: new Date().toLocaleString(),
        },
      },
    );
  } catch (error) {
    console.error("❌ Failed to update local DB:", error);
  }
}

export async function loader({ request }) {
  const { session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const products = await getProductInDB(shop);
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

    return { rows, error: null };
  } catch (error) {
    return { rows: [], error: error.message };
  }
}

export default function ProductTag() {
  const { rows = [], error = null } = useLoaderData() || {};
  const [tag, setTag] = useState("");
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const revalidator = useRevalidator();

  const isSubmitting = navigation.state === "submitting";

  const [toastActive, setToastActive] = useState(false);
  const [toastMessage, setToastMessage] = useState("");
  const [toastError, setToastError] = useState(false);

  const [addTagModalActive, setAddTagModalActive] = useState(false);
  const [removeTagModalActive, setRemoveTagModalActive] = useState(false);

  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [collectionFilter, setCollectionFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [tagFilter, setTagFilter] = useState([]);
  const [sortSelected, setSortSelected] = useState(["title-asc"]);
  const [taggedWith, setTaggedWith] = useState("");
  const [selectedResources, setSelectedResources] = useState([]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  const { mode, setMode } = useSetIndexFiltersMode();

  useEffect(() => {
    if (actionData) {
      if (actionData.success || actionData.partialSuccess) {
        setToastMessage(actionData.message);
        setToastError(false);
        setToastActive(true);

        setAddTagModalActive(false);
        setRemoveTagModalActive(false);
        setTag("");
        setSelectedResources([]);
        setTimeout(() => {
          revalidator.revalidate();
        }, 1000);
      } else {
        setToastMessage(actionData.error || "An error occurred");
        setToastError(true);
        setToastActive(true);
      }
    }
  }, [actionData, revalidator]);

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
    const tags = [
      ...new Set(
        rows
          .flatMap((r) => (Array.isArray(r.tags) ? r.tags : []))
          .map((t) => t.trim())
          .filter(Boolean),
      ),
    ];
    const allCols = rows.flatMap((r) => r.collections);
    const collections = [
      ...new Map(allCols.map((c) => [c.title, c])).values(),
    ].filter((c) => c.title && c.title !== "—");

    return {
      statuses: statuses.map((s) => ({ label: capitalize(s), value: s })),
      vendors: vendors.map((v) => ({ label: v, value: v })),
      types: types.map((t) => ({ label: t, value: t })),
      categories: categories.map((c) => ({ label: c, value: c })),
      tags: tags.map((t) => ({ label: t, value: t })),
      collections: collections.map((c) => ({
        label: c.title,
        value: c.title,
      })),
    };
  }, [rows]);

  const filteredAndSortedRows = useMemo(() => {
    let filtered = [...rows];

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
    if (statusFilter.length)
      filtered = filtered.filter((r) => statusFilter.includes(r.status));
    if (vendorFilter.length)
      filtered = filtered.filter((r) => vendorFilter.includes(r.vendor));
    if (typeFilter.length)
      filtered = filtered.filter((r) => typeFilter.includes(r.productType));
    if (categoryFilter.length)
      filtered = filtered.filter((r) => categoryFilter.includes(r.category));
    if (tagFilter.length) {
      filtered = filtered.filter(
        (r) =>
          Array.isArray(r.tags) &&
          r.tags.some((tag) =>
            tagFilter.some((f) => tag.toLowerCase() === f.toLowerCase()),
          ),
      );
    }
    if (collectionFilter.length) {
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
      filtered.sort((a, b) => {
        let aV =
          sortKey === "collections"
            ? a.collections?.length || 0
            : a[sortKey] || "";
        let bV =
          sortKey === "collections"
            ? b.collections?.length || 0
            : b[sortKey] || "";
        if (typeof aV === "string") {
          aV = aV.toLowerCase();
          bV = bV.toLowerCase();
        }
        return (dir === "asc" ? 1 : -1) * (aV > bV ? 1 : aV < bV ? -1 : 0);
      });
    }

    return filtered;
  }, [
    rows,
    queryValue,
    taggedWith,
    statusFilter,
    vendorFilter,
    typeFilter,
    tagFilter,
    categoryFilter,
    collectionFilter,
    sortSelected,
  ]);

  // Pagination calculations
  const totalPages = Math.ceil(filteredAndSortedRows.length / ITEMS_PER_PAGE);
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedRows = filteredAndSortedRows.slice(startIndex, endIndex);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [
    queryValue,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
    tagFilter,
  ]);

  const handleSelectionChange = useCallback(
    (selectionType, toggleType, selection) => {
      if (selectionType === "all") {
        // Select ALL products across all pages
        setSelectedResources(
          selectedResources.length === filteredAndSortedRows.length
            ? []
            : filteredAndSortedRows.map((r) => r.id),
        );
      } else if (selectionType === "page") {
        // Select all on current page
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
        setSelectedResources((prev) =>
          prev.includes(selection)
            ? prev.filter((id) => id !== selection)
            : [...prev, selection],
        );
      }
    },
    [filteredAndSortedRows, paginatedRows, selectedResources],
  );

  // Select all products (across all pages)
  const handleSelectAllProducts = useCallback(() => {
    setSelectedResources(filteredAndSortedRows.map((r) => r.id));
  }, [filteredAndSortedRows]);

  useEffect(() => {
    setSelectedResources([]);
  }, [
    queryValue,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
  ]);

  const handleTagSubmit = useCallback(
    (actionType) => {
      if (!tag || !tag.trim()) return;
      if (selectedResources.length === 0) return;

      const selectedProducts = rows.filter((r) =>
        selectedResources.includes(r.id),
      );

      const formData = new FormData();
      formData.append("actionType", actionType);
      formData.append("tag", tag.trim());
      formData.append(
        "products",
        JSON.stringify(
          selectedProducts.map((p) => ({
            id: p.id,
            tags: p.tags,
          })),
        ),
      );

      submit(formData, { method: "post" });
    },
    [tag, selectedResources, rows, submit],
  );

  const selectedProductsWithTags = useMemo(
    () => rows.filter((row) => selectedResources.includes(row.id)),
    [rows, selectedResources],
  );

  const commonTags = useMemo(() => {
    if (selectedProductsWithTags.length === 0) return [];
    const tagSet = new Set();
    selectedProductsWithTags.forEach((product) => {
      product.tags.forEach((t) => tagSet.add(t));
    });
    return Array.from(tagSet).sort();
  }, [selectedProductsWithTags]);

  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setTaggedWith("");
    setStatusFilter([]);
    setVendorFilter([]);
    setTypeFilter([]);
    setCategoryFilter([]);
    setCollectionFilter([]);
  }, []);

  const appliedFilters = [];
  if (statusFilter.length)
    appliedFilters.push({
      key: "status",
      label: disambiguateLabel("Status", statusFilter),
      onRemove: () => setStatusFilter([]),
    });
  if (vendorFilter.length)
    appliedFilters.push({
      key: "vendor",
      label: disambiguateLabel("Vendor", vendorFilter),
      onRemove: () => setVendorFilter([]),
    });
  if (typeFilter.length)
    appliedFilters.push({
      key: "type",
      label: disambiguateLabel("Type", typeFilter),
      onRemove: () => setTypeFilter([]),
    });
  if (categoryFilter.length)
    appliedFilters.push({
      key: "category",
      label: disambiguateLabel("Category", categoryFilter),
      onRemove: () => setCategoryFilter([]),
    });
  if (tagFilter.length)
    appliedFilters.push({
      key: "tags",
      label: disambiguateLabel("Tags", tagFilter),
      onRemove: () => setTagFilter([]),
    });
  if (collectionFilter.length) {
    const names = filterOptions.collections
      .filter((c) => collectionFilter.includes(c.value))
      .map((c) => c.label);
    appliedFilters.push({
      key: "collection",
      label: disambiguateLabel("Collection", names),
      onRemove: () => setCollectionFilter([]),
    });
  }
  if (taggedWith)
    appliedFilters.push({
      key: "taggedWith",
      label: `Tagged with: ${taggedWith}`,
      onRemove: () => setTaggedWith(""),
    });

  const filters = [
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
    {
      key: "tag",
      label: "Tag",
      filter: (
        <ChoiceList
          title="Tag"
          titleHidden
          choices={filterOptions.tags}
          selected={tagFilter}
          onChange={setTagFilter}
          allowMultiple
        />
      ),
    },
  ];

  const rowMarkup = paginatedRows.map((row, index) => (
    <IndexTable.Row
      id={row.id}
      key={row.id}
      position={index}
      selected={selectedResources.includes(row.id)}
      disabled={isSubmitting}
    >
      <IndexTable.Cell>
        <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
          {row.image ? (
            <Thumbnail source={row.image} alt={row.imageAlt} size="small" />
          ) : (
            <Thumbnail source={ImageIcon} alt="No image" size="small" />
          )}
          <Text variant="bodyMd" as="span" fontWeight="medium">
            {row.title}
          </Text>
        </div>
      </IndexTable.Cell>
      <IndexTable.Cell>
        <Badge tone={statusTone(row.status)}>{capitalize(row.status)}</Badge>
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
  ));

  if (error) {
    return (
      <Page title="Products" fullWidth>
        <Card>
          <BlockStack gap="400">
            <Text variant="headingMd" as="h2">
              Error loading products
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
      <Page title="Products tag" fullWidth>
        <Card>
          <EmptyState
            heading="No products found"
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

  const toastMarkup = toastActive ? (
    <Toast
      content={toastMessage}
      onDismiss={() => setToastActive(false)}
      error={toastError}
      duration={5000}
    />
  ) : null;

  return (
    <Frame>
      <Page title="Products tags" fullWidth>
        <div
          style={{
            display: "flex",
            justifyContent: "end",
            gap: "8px",
            marginBottom: "12px",
          }}
        >
          <Button
            onClick={() => setAddTagModalActive(true)}
            disabled={selectedResources.length === 0 || isSubmitting}
          >
            Add Tag
          </Button>
          <Button
            tone="critical"
            onClick={() => setRemoveTagModalActive(true)}
            disabled={selectedResources.length === 0 || isSubmitting}
          >
            Remove Tag
          </Button>
        </div>

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
              queryPlaceholder="Searching all products"
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

            {/* Select All Button */}

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
            >
              {rowMarkup}
            </IndexTable>

            {/* Pagination */}
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
        <AddTagModal
          selectedResources={selectedResources}
          handleClose={() => {
            setAddTagModalActive(false);
            setTag("");
          }}
          tag={tag}
          setTag={setTag}
          handleTagSubmit={() => handleTagSubmit("add")}
          active={addTagModalActive}
          isProcessing={isSubmitting}
          allTags={filterOptions.tags.map((t) => t.value)}
        />

        <RemoveTagModal
          selectedResources={selectedResources}
          selectedProducts={selectedProductsWithTags}
          commonTags={commonTags}
          handleClose={() => {
            setRemoveTagModalActive(false);
            setTag("");
          }}
          tag={tag}
          setTag={setTag}
          handleTagSubmit={() => handleTagSubmit("remove")}
          active={removeTagModalActive}
          isProcessing={isSubmitting}
        />

        {toastMarkup}
      </Page>
    </Frame>
  );
}

function disambiguateLabel(key, value) {
  return `${key}: ${(Array.isArray(value) ? value : [value]).map(capitalize).join(", ")}`;
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

const AddTagModal = ({
  tag,
  setTag,
  handleTagSubmit,
  handleClose,
  active,
  selectedResources,
  isProcessing,
  allTags,
}) => {
  const [options, setOptions] = useState([]);

  const updateText = useCallback(
    (value) => {
      setTag(value);
      if (value === "") {
        setOptions([]);
        return;
      }

      const filterRegex = new RegExp(value, "i");
      const resultOptions = allTags
        .filter((t) => t.match(filterRegex))
        .slice(0, 10);
      setOptions(resultOptions);
    },
    [allTags, setTag],
  );

  const optionsMarkup =
    options.length > 0
      ? options.map((option) => <Listbox.Option key={option} value={option} />)
      : null;

  return (
    <Modal
      open={active}
      onClose={handleClose}
      loading={isProcessing}
      title="Add tags"
      primaryAction={{
        content: isProcessing ? "Adding..." : "Add",
        onAction: handleTagSubmit,
        disabled: selectedResources.length === 0 || !tag.trim(),
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
          <Text variant="bodyMd" tone="subdued" as="p">
            {selectedResources.length === 0
              ? "No product selected"
              : `Add a tag to ${selectedResources.length} selected product${selectedResources.length > 1 ? "s" : ""}`}
          </Text>

          <Combobox
            activator={
              <Combobox.TextField
                label="Tag"
                value={tag}
                onChange={updateText}
                placeholder="Enter tag name..."
                autoComplete="off"
                disabled={selectedResources.length === 0 || isProcessing}
              />
            }
          >
            {optionsMarkup && (
              <Listbox onSelect={updateText}>{optionsMarkup}</Listbox>
            )}
          </Combobox>

          {allTags.length > 0 && !tag && (
            <Text variant="bodySm" tone="subdued">
              Popular tags: {allTags.slice(0, 5).join(", ")}
              {allTags.length > 5 && ` (+${allTags.length - 5} more)`}
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};

const RemoveTagModal = ({
  tag,
  setTag,
  handleTagSubmit,
  handleClose,
  active,
  selectedResources,
  selectedProducts,
  commonTags,
  isProcessing,
}) => {
  return (
    <Modal
      open={active}
      onClose={handleClose}
      loading={isProcessing}
      title="Remove tags"
      primaryAction={{
        content: isProcessing ? "Removing..." : "Remove",
        onAction: handleTagSubmit,
        disabled: selectedResources.length === 0 || !tag.trim(),
        loading: isProcessing,
        destructive: true,
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
          <Text variant="bodyMd" tone="subdued" as="p">
            {selectedResources.length === 0
              ? "No product selected"
              : `Remove a tag from ${selectedResources.length} selected product${selectedResources.length > 1 ? "s" : ""}`}
          </Text>

          {commonTags.length > 0 && (
            <>
              <Text variant="bodySm" fontWeight="semibold">
                Common tags in selected products (click to select):
              </Text>
              <div style={{ display: "flex", flexWrap: "wrap", gap: "8px" }}>
                {commonTags.map((t) => (
                  <Button
                    key={t}
                    size="slim"
                    onClick={() => setTag(t)}
                    variant={tag === t ? "primary" : undefined}
                    disabled={isProcessing}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            </>
          )}

          <TextField
            label="Tag to remove"
            value={tag}
            onChange={(e) => setTag(e)}
            disabled={selectedResources.length === 0 || isProcessing}
            placeholder="Click tag above or type..."
            autoComplete="off"
          />

          {commonTags.length === 0 && selectedResources.length > 0 && (
            <Text variant="bodySm" tone="subdued">
              No common tags found in selected products
            </Text>
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
};
