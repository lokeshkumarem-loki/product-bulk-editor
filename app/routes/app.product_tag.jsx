// =====================================================
// ProductTag.jsx - COMPLETE WITH PROGRESS OVERLAY
// =====================================================

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
  Banner,
  Modal,
  ProgressBar,
  InlineStack,
  Spinner,
  Button,
  Frame,
  LegacyStack,
  TextField,
} from "@shopify/polaris";
import fs from "fs";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getProductInDB } from "./server/services/product";
import { jsonlConvert } from "./utils/jsonlConvertor";
import {
  useLoaderData,
  useActionData,
  useSubmit,
  useNavigation,
} from "react-router";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import { PRODUCT_UPDATE_MUTATION } from "./queries/tagMutation";

// =====================================================
// ACTION
// =====================================================
export async function action({ request }) {
  const { admin } = await authenticate.admin(request);

  try {
    const formData = await request.formData();
    const tag = formData.get("tag");
    const products = JSON.parse(formData.get("products") || "[]");

    const productIds = products.map((p) => p.id);

    // 1️⃣ Create JSONL
    const { filePath } = await jsonlConvert(productIds, tag);

    // 2️⃣ Create staged upload
    const STAGED_UPLOAD_MUTATION = `
      mutation {
        stagedUploadsCreate(input: [{
          resource: BULK_MUTATION_VARIABLES,
          filename: "productData.jsonl",
          mimeType: "text/jsonl",
          httpMethod: POST
        }]) {
          stagedTargets {
            url
            resourceUrl
            parameters {
              name
              value
            }
          }
          userErrors {
            message
          }
        }
      }
    `;

    const stagedRes = await admin.graphql(STAGED_UPLOAD_MUTATION);
    const stagedJson = await stagedRes.json();
    const target = stagedJson.data.stagedUploadsCreate.stagedTargets[0];

    const uploadForm = new FormData();
    target.parameters.forEach(({ name, value }) =>
      uploadForm.append(name, value),
    );

    uploadForm.append("file", fs.createReadStream(filePath));

    await fetch(target.url, {
      method: "POST",
      body: uploadForm,
    });

    const stagedUploadPath = target.parameters.find(
      (p) => p.name === "key",
    ).value;

    await admin.graphql(PRODUCT_UPDATE_MUTATION(stagedUploadPath));
    fs.unlinkSync(filePath);
    return { success: true };
  } catch (error) {
    console.error("Bulk tag update failed:", error);
    return { success: false, error: error.message };
  }
}

// =====================================================
// LOADER
// =====================================================
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
    console.error("ProductTag loader error:", error);
    return { rows: [], error: error.message };
  }
}

// =====================================================
// COMPONENT
// =====================================================
export default function ProductTag() {
  const { rows = [], error = null } = useLoaderData() || {};
  const [tag, setTag] = useState("");
  const actionData = useActionData();
  const submit = useSubmit();
  const navigation = useNavigation();
  const tagManagerRef = useRef(null);

  // model state
  const [active, setActive] = useState(true);

  const handleAddTagModelToggle = useCallback(
    () => setActive(!active),
    [active],
  );

  // Check if form is submitting
  const isSubmitting = navigation.state === "submitting";

  // States
  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [collectionFilter, setCollectionFilter] = useState([]);
  const [sortSelected, setSortSelected] = useState(["title-asc"]);
  const [taggedWith, setTaggedWith] = useState("");
  const [bannerVisible, setBannerVisible] = useState(false);
  const [selectedResources, setSelectedResources] = useState([]);
  const [isProcessing, setIsProcessing] = useState(false);

  // Progress modal state
  const [progressModalOpen, setProgressModalOpen] = useState(false);
  const [operationInfo, setOperationInfo] = useState({
    tag: "",
    action: "",
    count: 0,
  });
  const { mode, setMode } = useSetIndexFiltersMode();

  // Show/hide progress modal based on submission state
  useEffect(() => {
    if (isSubmitting) {
      setProgressModalOpen(true);
    }
  }, [isSubmitting]);

  // Handle action response
  useEffect(() => {
    if (actionData) {
      setProgressModalOpen(false);
      setBannerVisible(true);

      // Auto-hide banner after 7 seconds
      const timer = setTimeout(() => {
        setBannerVisible(false);
      }, 7000);

      return () => clearTimeout(timer);
    }
  }, [actionData]);

  // Filter options
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
    const allCols = rows.flatMap((r) => r.collections);
    const collections = [
      ...new Map(allCols.map((c) => [c.id || c.title, c])).values(),
    ].filter((c) => c.title && c.title !== "—");

    return {
      statuses: statuses.map((s) => ({ label: capitalize(s), value: s })),
      vendors: vendors.map((v) => ({ label: v, value: v })),
      types: types.map((t) => ({ label: t, value: t })),
      categories: categories.map((c) => ({ label: c, value: c })),
      collections: collections.map((c) => ({
        label: c.title,
        value: c.id || c.title,
      })),
    };
  }, [rows]);

  // Filter & sort
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
    categoryFilter,
    collectionFilter,
    sortSelected,
  ]);

  // Selection
  const handleSelectionChange = useCallback(
    (selectionType, isSelecting, selection) => {
      if (selectionType === "all") {
        setSelectedResources(
          isSelecting ? filteredAndSortedRows.map((r) => r.id) : [],
        );
      } else if (selectionType === "page") {
        setSelectedResources(
          isSelecting ? filteredAndSortedRows.map((r) => r.id) : [],
        );
      } else if (selectionType === "single") {
        setSelectedResources((prev) =>
          prev.includes(selection)
            ? prev.filter((id) => id !== selection)
            : [...prev, selection],
        );
      }
    },
    [filteredAndSortedRows],
  );

  // Reset selection on filter change
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

  // Handle tag submission
  const handleTagSubmit = useCallback(
    (actionType) => {
      if (!tag || !tag.trim()) return;
      if (selectedResources.length === 0) return;
      setIsProcessing(true);
      const formData = new FormData();
      formData.append("actionType", actionType);
      formData.append("tag", tag.trim());
      formData.append("products", JSON.stringify(selectedResources));
      submit(formData, { method: "post" });
      setIsProcessing(false);
    },
    [selectedResources, submit],
  );

  // Get selected products with tags
  const selectedProductsWithTags = useMemo(
    () => rows.filter((row) => selectedResources.includes(row.id)),
    [rows, selectedResources],
  );

  // Handle remove tag
  const handleRemoveTag = useCallback(() => {
    if (tagManagerRef.current) {
      tagManagerRef.current.openRemove(selectedProductsWithTags);
    }
  }, [selectedProductsWithTags]);

  // Clear filters
  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setTaggedWith("");
    setStatusFilter([]);
    setVendorFilter([]);
    setTypeFilter([]);
    setCategoryFilter([]);
    setCollectionFilter([]);
  }, []);

  // Applied filters
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

  // Filters
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
  ];

  // Rows
  const rowMarkup = filteredAndSortedRows.map((row, index) => (
    <IndexTable.Row
      id={row.id}
      key={row.id}
      position={index}
      selected={selectedResources.includes(row.id)}
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

  // Bulk actions
  // const promotedBulkActions = [
  //   { content: "Add Tag", onAction: () => tagManagerRef.current?.openAdd() },
  //   {
  //     content: "Remove Tag",
  //     onAction: handleRemoveTag,
  //     disabled: selectedResources.length === 0,
  //   },
  // ];

  // Early returns
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
      <Page title="Products" fullWidth>
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

  // Render
  return (
    <Page title="Products" fullWidth>
      {bannerVisible && actionData && (
        <div style={{ marginBottom: "16px" }}>
          <Banner
            title={actionData.success ? "Success" : "Error"}
            tone={actionData.success ? "success" : "critical"}
            onDismiss={() => setBannerVisible(false)}
          >
            <BlockStack gap="200">
              <p>
                {actionData.success ? actionData.message : actionData.error}
              </p>
              {actionData.stats && (
                <Text variant="bodySm" tone="subdued" as="p">
                  Updated: {actionData.stats.updated} | Failed:{" "}
                  {actionData.stats.failed} | Time:{" "}
                  {(actionData.stats.timeMs / 1000).toFixed(1)}s
                </Text>
              )}
            </BlockStack>
          </Banner>
        </div>
      )}

      <div
        style={{
          display: "flex",
          justifyContent: "end",
          gap: "8px",
          marginBottom: "12px",
        }}
      >
        <Button onClick={handleAddTagModelToggle}>Add Tag</Button>
        <Button tone="critical">Remove Tag</Button>
      </div>

      <Card padding="0">
        <IndexFilters
          sortOptions={[
            { label: "Title", value: "title-asc", directionLabel: "A-Z" },
            { label: "Title", value: "title-desc", directionLabel: "Z-A" },
            { label: "Vendor", value: "vendor-asc", directionLabel: "A-Z" },
            { label: "Vendor", value: "vendor-desc", directionLabel: "Z-A" },
            { label: "Type", value: "productType-asc", directionLabel: "A-Z" },
            { label: "Type", value: "productType-desc", directionLabel: "Z-A" },
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
              content: "All",
              accessibilityLabel: "All products",
              panelID: "all-products-content",
            },
          ]}
          selected={0}
          canCreateNewView={false}
        />

        <IndexTable
          resourceName={{ singular: "product", plural: "products" }}
          itemCount={filteredAndSortedRows.length}
          selectedItemsCount={selectedResources.length}
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
      </Card>

      {/* Progress Modal */}
      <Modal
        open={progressModalOpen}
        onClose={() => {}} // Prevent closing during operation
        title={`${operationInfo.action === "add" ? "Adding" : "Removing"} Tag`}
        primaryAction={null}
        secondaryActions={[]}
      >
        <Modal.Section>
          <BlockStack gap="400">
            <Text variant="bodyMd" as="p">
              {operationInfo.action === "add" ? "Adding" : "Removing"} tag "
              {operationInfo.tag}"{" "}
              {operationInfo.action === "add" ? "to" : "from"}{" "}
              {operationInfo.count} product
              {operationInfo.count === 1 ? "" : "s"}...
            </Text>

            <ProgressBar progress={75} size="medium" tone="primary" />

            <InlineStack gap="200" align="center">
              <Spinner size="small" />
              <Text variant="bodySm" tone="subdued" as="p">
                Processing in batches (10 products per batch)...
              </Text>
            </InlineStack>

            <Text variant="bodySm" tone="subdued" as="p">
              This may take a moment for large selections. Please don't close
              this window.
            </Text>
          </BlockStack>
        </Modal.Section>
      </Modal>

      <AddTagModel
        selectedReasources={selectedResources}
        handleClose={handleAddTagModelToggle}
        tag={tag}
        setTag={setTag}
        handleTagSubmit={handleTagSubmit}
        active={active}
        isProcessing={isProcessing}
      />
    </Page>
  );
}

// Helpers
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

const AddTagModel = ({
  tag,
  setTag,
  handleSubmitTag,
  handleClose,
  active,
  selectedReasources,
  isProcessing,
}) => {
  return (
    <div style={{ height: "500px" }}>
      <Frame>
        <Modal
          open={active}
          onClose={handleClose}
          loading={isProcessing}
          title="Add tags"
          primaryAction={{
            content: "Add",
            onAction: handleSubmitTag,
            disabled: selectedReasources.length == 0 || tag.length == 0,
          }}
          secondaryActions={[
            {
              content: "Cancel",
              onAction: handleClose,
            },
          ]}
        >
          <Modal.Section>
            <LegacyStack vertical>
              <LegacyStack.Item>
                <Text variant="bodyMd" tone="subdued" as="p">
                  {selectedReasources.length == 0
                    ? "No product selected, filter or select product"
                    : `Add a tag to ${selectedReasources.length} selected product${selectedReasources.length > 1 ? "s" : ""}.`}
                </Text>
              </LegacyStack.Item>
              <LegacyStack.Item>
                <TextField
                  value={tag}
                  onChange={(e) => setTag(e)}
                  disabled={selectedReasources.length == 0}
                  placeholder="Summer offer, New sale..."
                  label="Tag"
                />
              </LegacyStack.Item>
            </LegacyStack>
          </Modal.Section>
        </Modal>
      </Frame>
    </div>
  );
};
