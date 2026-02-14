import {
  Card,
  IndexTable,
  Text,
  Badge,
  Thumbnail,
  IndexFilters,
  useSetIndexFiltersMode,
  ChoiceList,
  EmptyState,
  BlockStack,
  Button,
  InlineStack,
  Pagination,
} from "@shopify/polaris";
import { ImageIcon } from "@shopify/polaris-icons";
import { useState, useCallback, useMemo, useEffect } from "react";

const ITEMS_PER_PAGE = 50;

export function VariantsTable({
  variantsData = [],
  handleSubmit,
  currencyCode,
  actionType = "remove",
  isLoading = false,
  clearSelection = false,
}) {
  // Filter variants based on action type
  const validVariants = useMemo(() => {
    return variantsData.filter((v) => {
      const compareAt = Number(v.compareAtPrice) || 0;
      return actionType === "remove" ? compareAt > 0 : compareAt === 0;
    });
  }, [variantsData, actionType]);

  // Filter and sort states
  const [queryValue, setQueryValue] = useState("");
  const [productTypeFilter, setProductTypeFilter] = useState([]);
  const [tagFilter, setTagFilter] = useState([]);
  const [sortSelected, setSortSelected] = useState(["productTitle-asc"]);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);

  // Selection state
  const [selectedResources, setSelectedResources] = useState([]);

  const { mode, setMode } = useSetIndexFiltersMode();

  // Clear selection when clearSelection prop changes
  useEffect(() => {
    if (clearSelection) {
      setSelectedResources([]);
      setCurrentPage(1);
    }
  }, [clearSelection]);

  // Filter options
  const filterOptions = useMemo(() => {
    const types = [
      ...new Set(validVariants.map((v) => v.productType).filter(Boolean)),
    ].sort();

    const allTags = validVariants.flatMap((v) => v.tags || []);
    const uniqueTags = [...new Set(allTags)].filter(Boolean).sort();

    return {
      productTypes: types.map((type) => ({ label: type, value: type })),
      tags: uniqueTags.map((tag) => ({ label: tag, value: tag })),
    };
  }, [validVariants]);

  // Filter and sort variants
  const filteredAndSortedVariants = useMemo(() => {
    let filtered = [...validVariants];

    // Search filter
    if (queryValue) {
      const q = queryValue.toLowerCase();
      filtered = filtered.filter(
        (v) =>
          v.productTitle?.toLowerCase().includes(q) ||
          v.variantTitle?.toLowerCase().includes(q) ||
          v.productType?.toLowerCase().includes(q),
      );
    }

    // Product type filter
    if (productTypeFilter.length > 0) {
      filtered = filtered.filter((v) =>
        productTypeFilter.includes(v.productType),
      );
    }

    // Tag filter
    if (tagFilter.length > 0) {
      filtered = filtered.filter((v) =>
        v.tags?.some((tag) => tagFilter.includes(tag)),
      );
    }

    // Sorting
    if (sortSelected.length > 0) {
      const [sortKey, direction] = sortSelected[0].split("-");
      filtered.sort((a, b) => {
        let aVal = a[sortKey];
        let bVal = b[sortKey];

        if (typeof aVal === "string" && typeof bVal === "string") {
          aVal = aVal.toLowerCase();
          bVal = bVal.toLowerCase();
        }

        if (sortKey === "price" || sortKey === "compareAtPrice") {
          aVal = Number(aVal) || 0;
          bVal = Number(bVal) || 0;
        }

        const comparison = aVal > bVal ? 1 : aVal < bVal ? -1 : 0;
        return direction === "asc" ? comparison : -comparison;
      });
    }

    return filtered;
  }, [validVariants, queryValue, productTypeFilter, tagFilter, sortSelected]);

  // Pagination calculations
  const totalPages = Math.ceil(
    filteredAndSortedVariants.length / ITEMS_PER_PAGE,
  );
  const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
  const endIndex = startIndex + ITEMS_PER_PAGE;
  const paginatedVariants = filteredAndSortedVariants.slice(
    startIndex,
    endIndex,
  );

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [queryValue, productTypeFilter, tagFilter, sortSelected]);

  // Get selected variant IDs
  const selectedIds = useMemo(
    () => selectedResources.map((r) => r.variantId),
    [selectedResources],
  );

  // Handle selection changes
  const handleSelectionChange = useCallback(
    (selectionType, toggleType, selection) => {
      const allFilteredData = filteredAndSortedVariants.map((v) => ({
        productId: v.productId,
        variantId: v.variantId,
        id: v.id,
        compareAtPrice: v.compareAtPrice,
        price: v.price,
        productTitle: v.productTitle,
      }));

      if (selectionType === "all") {
        // Select ALL across all pages
        setSelectedResources(
          selectedResources.length === allFilteredData.length
            ? []
            : allFilteredData,
        );
      } else if (selectionType === "page") {
        // Select all on current page only
        const pageData = paginatedVariants.map((v) => ({
          productId: v.productId,
          variantId: v.variantId,
          id: v.id,
          compareAtPrice: v.compareAtPrice,
          price: v.price,
          productTitle: v.productTitle,
        }));

        if (toggleType) {
          // Add current page selections
          const newSelections = [...selectedResources];
          pageData.forEach((item) => {
            if (!selectedIds.includes(item.variantId)) {
              newSelections.push(item);
            }
          });
          setSelectedResources(newSelections);
        } else {
          // Remove current page selections
          const pageIds = pageData.map((d) => d.variantId);
          setSelectedResources(
            selectedResources.filter(
              (item) => !pageIds.includes(item.variantId),
            ),
          );
        }
      } else if (selectionType === "single") {
        const variantId = selection;
        const isSelected = selectedIds.includes(variantId);

        if (isSelected) {
          setSelectedResources(
            selectedResources.filter((item) => item.variantId !== variantId),
          );
        } else {
          const variantData = allFilteredData.find(
            (v) => v.variantId === variantId,
          );
          if (variantData) {
            setSelectedResources([...selectedResources, variantData]);
          }
        }
      }
    },
    [
      selectedResources,
      filteredAndSortedVariants,
      selectedIds,
      paginatedVariants,
    ],
  );

  // Select all variants (across all pages)
  const handleSelectAllVariants = useCallback(() => {
    const allVariantData = filteredAndSortedVariants.map((v) => ({
      productId: v.productId,
      variantId: v.variantId,
      id: v.id,
      compareAtPrice: v.compareAtPrice,
      price: v.price,
      productTitle: v.productTitle,
    }));
    setSelectedResources(allVariantData);
  }, [filteredAndSortedVariants]);

  // Clear all filters
  const handleClearAll = useCallback(() => {
    setQueryValue("");
    setProductTypeFilter([]);
    setTagFilter([]);
  }, []);

  // Applied filters
  const appliedFilters = [];
  if (productTypeFilter.length > 0) {
    appliedFilters.push({
      key: "productType",
      label: disambiguateLabel("Product Type", productTypeFilter),
      onRemove: () => setProductTypeFilter([]),
    });
  }
  if (tagFilter.length > 0) {
    appliedFilters.push({
      key: "tag",
      label: disambiguateLabel("Tag", tagFilter),
      onRemove: () => setTagFilter([]),
    });
  }

  // Filter configuration
  const filters = [
    {
      key: "productType",
      label: "Product Type",
      shortcut: true,
      filter: (
        <ChoiceList
          title="Product Type"
          titleHidden
          choices={filterOptions.productTypes}
          selected={productTypeFilter}
          onChange={setProductTypeFilter}
          allowMultiple
        />
      ),
    },
    {
      key: "tag",
      label: "Tags",
      shortcut: true,
      filter: (
        <ChoiceList
          title="Tags"
          titleHidden
          choices={filterOptions.tags}
          selected={tagFilter}
          onChange={setTagFilter}
          allowMultiple
        />
      ),
    },
  ];

  // Calculate discount percentage
  const calculateDiscount = (price, comparePrice) => {
    if (!comparePrice || !price || comparePrice <= price) return null;
    const discount = ((comparePrice - price) / comparePrice) * 100;
    return Math.round(discount);
  };

  // Table rows (paginated)
  const rowMarkup = paginatedVariants.map((variant, index) => {
    const discountPercent = calculateDiscount(
      variant.price,
      variant.compareAtPrice,
    );

    return (
      <IndexTable.Row
        id={variant.variantId}
        key={variant.variantId}
        position={index}
        selected={selectedIds.includes(variant.variantId)}
        disabled={isLoading}
      >
        <IndexTable.Cell>
          <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
            {variant.image ? (
              <Thumbnail source={variant.image} alt="Product" size="small" />
            ) : (
              <Thumbnail source={ImageIcon} alt="No image" size="small" />
            )}
            <BlockStack gap="100">
              <Text variant="bodyMd" as="span" fontWeight="semibold">
                {variant.productTitle}
              </Text>
              <Text variant="bodySm" as="span" tone="subdued">
                {variant.variantTitle}
              </Text>
            </BlockStack>
          </div>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodyMd" as="span">
            {variant.productType || "—"}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          <Text variant="bodyMd" as="span" fontWeight="semibold">
            {currencyCode} {Number(variant.price).toFixed(2)}
          </Text>
        </IndexTable.Cell>

        <IndexTable.Cell>
          {actionType === "remove" && variant.compareAtPrice > 0 ? (
            <BlockStack gap="100">
              <Text variant="bodyMd" as="span" tone="subdued">
                {currencyCode} {Number(variant.compareAtPrice).toFixed(2)}
              </Text>
              {discountPercent && (
                <span>
                  <Badge tone="success">{discountPercent}% OFF</Badge>
                </span>
              )}
            </BlockStack>
          ) : (
            <Text variant="bodyMd" as="span" tone="subdued">
              —
            </Text>
          )}
        </IndexTable.Cell>
      </IndexTable.Row>
    );
  });

  // Promoted bulk actions
  const promotedBulkActions = [
    {
      content: actionType === "add" ? "Add Discount" : "Remove Discount",
      onAction: () => handleSubmit(selectedResources),
      disabled: isLoading || selectedResources.length === 0,
    },
  ];

  // Empty state - no valid variants
  if (validVariants.length === 0) {
    const emptyMessage =
      actionType === "add"
        ? "All variants already have discount pricing. Go to 'Remove Discount Price' to manage discounts."
        : "No variants have discount pricing. Go to 'Add Discount Price' to add discounts.";

    return (
      <Card>
        <EmptyState
          heading={
            actionType === "add"
              ? "No variants available for discount"
              : "No variants with discount found"
          }
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p" tone="subdued">
            {emptyMessage}
          </Text>
        </EmptyState>
      </Card>
    );
  }

  // Empty state - no filtered results
  if (filteredAndSortedVariants.length === 0) {
    return (
      <Card>
        <IndexFilters
          sortOptions={sortOptions}
          sortSelected={sortSelected}
          queryValue={queryValue}
          queryPlaceholder="Search variants..."
          onQueryChange={setQueryValue}
          onQueryClear={() => setQueryValue("")}
          onSort={setSortSelected}
          filters={filters}
          appliedFilters={appliedFilters}
          onClearAll={handleClearAll}
          mode={mode}
          setMode={setMode}
          tabs={[]}
          selected={0}
          canCreateNewView={false}
        />
        <EmptyState
          heading="No variants match your filters"
          image="https://cdn.shopify.com/s/files/1/0262/4071/2726/files/emptystate-files.png"
        >
          <Text as="p" tone="subdued">
            Try changing your filters or search term
          </Text>
        </EmptyState>
      </Card>
    );
  }

  return (
    <Card padding="0">
      {filteredAndSortedVariants.length > ITEMS_PER_PAGE && (
        <div style={{ padding: "8px", borderBottom: "1px solid #E1E3E5" }}>
          <InlineStack gap="200" align="end" blockAlign="center">
            {selectedResources.length < filteredAndSortedVariants.length && (
              <Button
                size="slim"
                onClick={handleSelectAllVariants}
                disabled={isLoading}
              >
                Select all {filteredAndSortedVariants.length} variants
              </Button>
            )}
            {selectedResources.length === filteredAndSortedVariants.length && (
              <Button
                size="slim"
                onClick={() => setSelectedResources([])}
                disabled={isLoading}
              >
                Deselect all
              </Button>
            )}
          </InlineStack>
        </div>
      )}

      <IndexFilters
        sortOptions={sortOptions}
        sortSelected={sortSelected}
        queryValue={queryValue}
        queryPlaceholder="Search by product or variant title..."
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
            id: "all-variants",
            content: `All (${validVariants.length})`,
            accessibilityLabel: "All variants",
            panelID: "all-variants-content",
          },
        ]}
        selected={0}
        canCreateNewView={false}
      />

      <IndexTable
        resourceName={{ singular: "variant", plural: "variants" }}
        itemCount={paginatedVariants.length}
        selectedItemsCount={
          selectedResources.length === filteredAndSortedVariants.length
            ? "All"
            : selectedResources.length
        }
        onSelectionChange={handleSelectionChange}
        headings={[
          { title: "Product" },
          { title: "Type" },
          { title: "Price" },
          { title: "Compare At Price" },
        ]}
        hasZebraStriping
        promotedBulkActions={promotedBulkActions}
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

      {/* Selection footer */}
      {selectedResources.length > 0 && (
        <div
          style={{
            padding: "16px",
            borderTop: "1px solid #E1E3E5",
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          <Text variant="bodySm" as="span" tone="subdued">
            {selectedResources.length} variant
            {selectedResources.length !== 1 ? "s" : ""} selected
            {selectedResources.length === filteredAndSortedVariants.length &&
              " (all)"}
          </Text>

          <Button
            onClick={() => handleSubmit(selectedResources)}
            variant="primary"
            tone={actionType === "remove" ? "critical" : undefined}
            disabled={isLoading}
            loading={isLoading}
          >
            {isLoading
              ? actionType === "add"
                ? "Adding..."
                : "Removing..."
              : actionType === "add"
                ? "Add Discount"
                : "Remove Discount"}
          </Button>
        </div>
      )}
    </Card>
  );
}

const sortOptions = [
  {
    label: "Product",
    value: "productTitle-asc",
    directionLabel: "A-Z",
  },
  {
    label: "Product",
    value: "productTitle-desc",
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
  {
    label: "Price",
    value: "price-asc",
    directionLabel: "Low to High",
  },
  {
    label: "Price",
    value: "price-desc",
    directionLabel: "High to Low",
  },
  {
    label: "Compare Price",
    value: "compareAtPrice-asc",
    directionLabel: "Low to High",
  },
  {
    label: "Compare Price",
    value: "compareAtPrice-desc",
    directionLabel: "High to Low",
  },
];

function disambiguateLabel(key, value) {
  return `${key}: ${value.join(", ")}`;
}
