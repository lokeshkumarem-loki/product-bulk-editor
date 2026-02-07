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
  Pagination,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { authenticate } from "../shopify.server";
import { getProductInDB } from "./server/services/product";
import { syncProductsAfterTagUpdate } from "./server/services/syncServices";
import { useLoaderData } from "react-router";
import { useState, useCallback, useMemo, useEffect, useRef } from "react";
import {
  buildBulkMutationQuery,
  buildTagsJsonl,
  POLL_BULK_OPERATION,
  uploadJSONL,
} from "./queries/tagMutation";
import TagManager from "./components/TagManager";

// =====================================================
// ACTION - FIXED with stagedUploadPath
// =====================================================
export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;

  try {
    const formData = await request.formData();
    const actionType = formData.get("actionType");
    const tag = formData.get("tag");
    const productIds = JSON.parse(formData.get("productIds") || "[]");

    if (!tag || !tag.trim()) {
      return { success: false, error: "Tag cannot be empty." };
    }
    if (!productIds || productIds.length === 0) {
      return { success: false, error: "No products selected." };
    }

    const products = await getProductInDB(shop);
    const safeProducts = Array.isArray(products) ? products : [];
    const allRows = safeProducts.map((p) => ({
      id: p.productId || p.id || p._id?.toString(),
      tags: Array.isArray(p.tags) ? p.tags : [],
    }));

    const jsonl = buildTagsJsonl(allRows, productIds, tag, actionType);
    if (!jsonl) return { success: false, error: "Nothing to update." };

    // Upload JSONL and get staged path
    const stagedPath = await uploadJSONL(admin, jsonl);

    // Start bulk operation with staged path
    const mutation = buildBulkMutationQuery(jsonl, stagedPath);
    const startRes = await admin.graphql(mutation);
    const startJson = await startRes.json();

    if (startJson.errors) {
      return {
        success: false,
        error: `GraphQL error: ${startJson.errors[0]?.message || "Unknown"}`,
      };
    }

    const userErrors = startJson.data?.bulkOperationRunMutation?.userErrors;
    if (userErrors?.length > 0) {
      return {
        success: false,
        error: `${userErrors[0].field}: ${userErrors[0].message}`,
      };
    }

    const operationId =
      startJson.data?.bulkOperationRunMutation?.bulkOperation?.id;
    if (!operationId)
      return { success: false, error: "No operation ID returned." };

    // Poll until completed
    const MAX_POLLS = 15;
    for (let i = 0; i < MAX_POLLS; i++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const pollRes = await admin.graphql(POLL_BULK_OPERATION(operationId));
      const pollJson = await pollRes.json();
      const bulk = pollJson.data?.node;

      if (!bulk)
        return { success: false, error: "Lost track of bulk operation." };

      if (bulk.status === "COMPLETED") {
        const syncResult = await syncProductsAfterTagUpdate(
          admin,
          shop,
          productIds,
        );
        return {
          success: true,
          message: `Tag "${tag.trim()}" ${actionType === "add" ? "added to" : "removed from"} ${productIds.length} product${productIds.length === 1 ? "" : "s"}. Synced ${syncResult.synced} to DB.`,
        };
      }

      if (bulk.status === "FAILED" || bulk.status === "CANCELED") {
        return {
          success: false,
          error: `Bulk operation ${bulk.status.toLowerCase()}.`,
        };
      }
    }

    return { success: false, error: "Bulk operation timed out." };
  } catch (error) {
    console.error("Action error:", error);
    return { success: false, error: error.message || "Unexpected error" };
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
// COMPONENT - FIXED with Select All across pages
// =====================================================
export default function AddMetafield() {
  const { rows = [], error = null } = useLoaderData() || {};
  const tagManagerRef = useRef(null);

  // States
  const [currentPage, setCurrentPage] = useState(1);
  const [queryValue, setQueryValue] = useState("");
  const [statusFilter, setStatusFilter] = useState([]);
  const [vendorFilter, setVendorFilter] = useState([]);
  const [typeFilter, setTypeFilter] = useState([]);
  const [categoryFilter, setCategoryFilter] = useState([]);
  const [collectionFilter, setCollectionFilter] = useState([]);
  const [sortSelected, setSortSelected] = useState(["title-asc"]);
  const [taggedWith, setTaggedWith] = useState("");

  const itemsPerPage = 50;
  const { mode, setMode } = useSetIndexFiltersMode();

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
    if (collectionFilter.length)
      filtered = filtered.filter((r) =>
        r.collections.some(
          (c) =>
            collectionFilter.includes(c.id) ||
            collectionFilter.includes(c.title),
        ),
      );

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

  // Pagination
  const paginatedRows = useMemo(() => {
    const start = (currentPage - 1) * itemsPerPage;
    return filteredAndSortedRows.slice(start, start + itemsPerPage);
  }, [filteredAndSortedRows, currentPage]);

  const totalPages = Math.ceil(filteredAndSortedRows.length / itemsPerPage);

  useEffect(() => {
    setCurrentPage(1);
  }, [
    queryValue,
    taggedWith,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
  ]);

  // FIXED: Custom selection state that works across all pages
  const [selectedResources, setSelectedResources] = useState([]);
  const [selectAllAcrossPages, setSelectAllAcrossPages] = useState(false);

  // Get currently displayed page IDs
  const currentPageIds = useMemo(
    () => paginatedRows.map((row) => row.id),
    [paginatedRows],
  );

  // Get all filtered product IDs (for select all)
  const allFilteredIds = useMemo(
    () => filteredAndSortedRows.map((row) => row.id),
    [filteredAndSortedRows],
  );

  // Handle selection change
  const handleSelectionChange = useCallback(
    (selectionType, toggleType, selection) => {
      if (selectionType === "all") {
        if (selectAllAcrossPages) {
          // Deselect all
          setSelectedResources([]);
          setSelectAllAcrossPages(false);
        } else {
          // Select all filtered products across all pages
          setSelectedResources(allFilteredIds);
          setSelectAllAcrossPages(true);
        }
      } else if (selectionType === "page") {
        if (toggleType) {
          // Select all on current page
          const newSelected = [
            ...new Set([...selectedResources, ...currentPageIds]),
          ];
          setSelectedResources(newSelected);

          // Check if all filtered products are now selected
          if (newSelected.length === allFilteredIds.length) {
            setSelectAllAcrossPages(true);
          }
        } else {
          // Deselect all on current page
          const newSelected = selectedResources.filter(
            (id) => !currentPageIds.includes(id),
          );
          setSelectedResources(newSelected);
          setSelectAllAcrossPages(false);
        }
      } else if (selectionType === "single") {
        const id = selection;
        const newSelected = selectedResources.includes(id)
          ? selectedResources.filter((selectedId) => selectedId !== id)
          : [...selectedResources, id];

        setSelectedResources(newSelected);

        // Update select all state
        if (newSelected.length === allFilteredIds.length) {
          setSelectAllAcrossPages(true);
        } else {
          setSelectAllAcrossPages(false);
        }
      } else if (selectionType === "multi") {
        const ids = selection;
        const newSelected = [...new Set([...selectedResources, ...ids])];
        setSelectedResources(newSelected);

        if (newSelected.length === allFilteredIds.length) {
          setSelectAllAcrossPages(true);
        }
      }
    },
    [selectedResources, selectAllAcrossPages, currentPageIds, allFilteredIds],
  );

  // Reset selection when filters change
  useEffect(() => {
    setSelectedResources([]);
    setSelectAllAcrossPages(false);
  }, [
    queryValue,
    taggedWith,
    statusFilter,
    vendorFilter,
    typeFilter,
    categoryFilter,
    collectionFilter,
  ]);

  // FIXED: Handle remove tag with existing tags
  const handleRemoveTag = useCallback(() => {
    if (tagManagerRef.current) {
      tagManagerRef.current.openRemove(rows);
    }
  }, [rows]);

  // Clear filters
  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setTaggedWith("");
    setStatusFilter([]);
    setVendorFilter([]);
    setTypeFilter([]);
    setCategoryFilter([]);
    setCollectionFilter([]);
    setCurrentPage(1);
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

  // Filter defs
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
  const rowMarkup = paginatedRows.map((row, index) => (
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

  const promotedBulkActions = [
    { content: "Add Tag", onAction: () => tagManagerRef.current?.openAdd() },
    { content: "Remove Tag", onAction: handleRemoveTag },
  ];

  // Early returns
  if (error) {
    return (
      <Page title="Add metafield" fullWidth>
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
      <Page title="Add metafield" fullWidth>
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
    <Page title="Add metafield" fullWidth>
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
          itemCount={paginatedRows.length}
          selectedItemsCount={
            selectAllAcrossPages ? "All" : selectedResources.length
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
              display: "flex",
              justifyContent: "center",
            }}
          >
            <Pagination
              hasPrevious={currentPage > 1}
              onPrevious={() => setCurrentPage((p) => Math.max(1, p - 1))}
              hasNext={currentPage < totalPages}
              onNext={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              label={`Page ${currentPage} of ${totalPages} (${selectedResources.length} selected)`}
            />
          </div>
        )}
      </Card>
    </Page>
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
