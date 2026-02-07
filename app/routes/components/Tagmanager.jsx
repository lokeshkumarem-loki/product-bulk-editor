// =====================================================
// components/TagManager.jsx - WITH PROGRESS TRACKING
// =====================================================

import { useState, useCallback, useImperativeHandle, forwardRef } from "react";
import {
  Modal,
  TextField,
  BlockStack,
  Text,
  Button,
  InlineStack,
  ProgressBar,
  Badge,
} from "@shopify/polaris";

const TagManager = forwardRef(({ selectedProductIds = [], onSubmit }, ref) => {
  // ── modal states ──────────────────────────────
  const [modalOpen, setModalOpen] = useState(false);
  const [modalAction, setModalAction] = useState("add"); // "add" | "remove"
  const [tagInput, setTagInput] = useState("");
  const [tagError, setTagError] = useState("");
  const [selectedProducts, setSelectedProducts] = useState([]);

  // ── progress states ───────────────────────────
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [currentBatch, setCurrentBatch] = useState(0);
  const [totalBatches, setTotalBatches] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);

  // ── expose methods to parent ──────────────────
  useImperativeHandle(ref, () => ({
    openAdd: () => {
      if (selectedProductIds.length === 0) {
        alert("Please select at least one product.");
        return;
      }
      setModalAction("add");
      setTagInput("");
      setTagError("");
      setSelectedProducts([]);
      resetProgress();
      setModalOpen(true);
    },
    openRemove: (productsWithTags = []) => {
      if (selectedProductIds.length === 0) {
        alert("Please select at least one product.");
        return;
      }
      setModalAction("remove");
      setTagInput("");
      setTagError("");
      setSelectedProducts(productsWithTags);
      resetProgress();
      setModalOpen(true);
    },
  }));

  // ── reset progress ────────────────────────────
  const resetProgress = useCallback(() => {
    setIsProcessing(false);
    setProgress(0);
    setCurrentBatch(0);
    setTotalBatches(0);
    setProcessedCount(0);
    setTotalCount(0);
  }, []);

  // ── close modal ───────────────────────────────
  const closeModal = useCallback(() => {
    if (isProcessing) {
      if (
        !confirm("Tag update is in progress. Are you sure you want to close?")
      ) {
        return;
      }
    }
    setModalOpen(false);
    setTagInput("");
    setTagError("");
    resetProgress();
  }, [isProcessing, resetProgress]);

  // ── handle submit ─────────────────────────────
  const handleSubmit = useCallback(() => {
    const trimmed = tagInput.trim();

    if (!trimmed) {
      setTagError("Please enter a tag.");
      return;
    }

    if (selectedProductIds.length === 0) {
      setTagError("No products selected.");
      return;
    }

    setTagError("");
    setIsProcessing(true);
    setTotalCount(selectedProductIds.length);

    // Calculate batches (10 products per batch)
    const batchSize = 10;
    const batches = Math.ceil(selectedProductIds.length / batchSize);
    setTotalBatches(batches);

    // Call parent's onSubmit with tag and action
    if (onSubmit) {
      onSubmit(trimmed, modalAction);
    }

    // Auto-close after a delay (parent handles actual submission)
    setTimeout(() => {
      setModalOpen(false);
      resetProgress();
    }, 1500);
  }, [tagInput, modalAction, selectedProductIds, onSubmit, resetProgress]);

  // ── get common tags (for remove action) ───────
  const commonTags = useCallback(() => {
    if (modalAction !== "remove" || selectedProducts.length === 0) {
      return [];
    }

    // Get tags that appear in ALL selected products
    const tagCounts = {};
    selectedProducts.forEach((product) => {
      if (Array.isArray(product.tags)) {
        product.tags.forEach((tag) => {
          const lowerTag = tag.toLowerCase();
          tagCounts[lowerTag] = (tagCounts[lowerTag] || 0) + 1;
        });
      }
    });

    // Filter tags that appear in all selected products
    const common = Object.entries(tagCounts)
      .filter(([_, count]) => count === selectedProducts.length)
      .map(([tag]) => tag);

    return common;
  }, [modalAction, selectedProducts]);

  // ── render tag suggestions (for remove) ───────
  const TagSuggestions = () => {
    if (modalAction !== "remove") return null;

    const tags = commonTags();
    if (tags.length === 0) {
      return (
        <Text variant="bodySm" tone="subdued" as="p">
          No common tags found across selected products.
        </Text>
      );
    }

    return (
      <BlockStack gap="200">
        <Text variant="bodySm" tone="subdued" as="p">
          Common tags:
        </Text>
        <InlineStack gap="100" wrap>
          {tags.map((tag) => (
            <Button key={tag} size="slim" onClick={() => setTagInput(tag)}>
              {tag}
            </Button>
          ))}
        </InlineStack>
      </BlockStack>
    );
  };

  // ── render progress section ───────────────────
  const ProgressSection = () => {
    if (!isProcessing) return null;

    return (
      <BlockStack gap="300">
        <Text variant="bodyMd" fontWeight="semibold" as="p">
          Processing {modalAction === "add" ? "tag addition" : "tag removal"}...
        </Text>

        <ProgressBar progress={progress} size="small" tone="primary" />

        <BlockStack gap="100">
          <Text variant="bodySm" tone="subdued" as="p">
            Processed: {processedCount} / {totalCount} products
          </Text>
          {totalBatches > 1 && (
            <Text variant="bodySm" tone="subdued" as="p">
              Batch: {currentBatch} / {totalBatches}
            </Text>
          )}
        </BlockStack>

        <InlineStack gap="200" align="center">
          <div
            className="spinner"
            style={{
              width: "16px",
              height: "16px",
              border: "2px solid #E4E5E7",
              borderTop: "2px solid #008060",
              borderRadius: "50%",
              animation: "spin 1s linear infinite",
            }}
          />
          <Text variant="bodySm" as="p">
            Please wait...
          </Text>
        </InlineStack>

        <style>{`
          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }
        `}</style>
      </BlockStack>
    );
  };

  // ── render ────────────────────────────────────
  return (
    <Modal
      open={modalOpen}
      onClose={closeModal}
      title={modalAction === "add" ? "Add Tag" : "Remove Tag"}
      primaryAction={{
        content: isProcessing
          ? "Processing..."
          : modalAction === "add"
            ? "Add Tag"
            : "Remove Tag",
        onAction: handleSubmit,
        destructive: modalAction === "remove",
        disabled: isProcessing,
        loading: isProcessing,
      }}
      secondaryActions={
        isProcessing
          ? []
          : [
              {
                content: "Cancel",
                onAction: closeModal,
              },
            ]
      }
    >
      <Modal.Section>
        <BlockStack gap="400">
          {!isProcessing ? (
            <>
              <Text variant="bodyMd" tone="subdued" as="p">
                {modalAction === "add"
                  ? `Add a tag to ${selectedProductIds.length} selected product${selectedProductIds.length === 1 ? "" : "s"}.`
                  : `Remove a tag from ${selectedProductIds.length} selected product${selectedProductIds.length === 1 ? "" : "s"}.`}
              </Text>

              <TextField
                label="Tag"
                value={tagInput}
                onChange={(val) => {
                  setTagInput(val);
                  setTagError("");
                }}
                autoComplete="off"
                error={tagError}
                placeholder={
                  modalAction === "add" ? "e.g. summer-sale" : "e.g. clearance"
                }
                helpText={
                  modalAction === "remove"
                    ? "Only products with this tag will be affected."
                    : "Tag will be added to all selected products."
                }
                autoFocus
                onKeyPress={(e) => {
                  if (e.key === "Enter") {
                    handleSubmit();
                  }
                }}
              />

              <TagSuggestions />

              {selectedProductIds.length > 50 && (
                <Badge tone="info">
                  Large batch: {selectedProductIds.length} products. This may
                  take a minute.
                </Badge>
              )}
            </>
          ) : (
            <ProgressSection />
          )}
        </BlockStack>
      </Modal.Section>
    </Modal>
  );
});

TagManager.displayName = "TagManager";

export default TagManager;
