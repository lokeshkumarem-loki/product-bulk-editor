import {
  Button,
  Page,
  TextField,
  Card,
  Banner,
  BlockStack,
  InlineStack,
  Icon,
  Checkbox,
  Text,
} from "@shopify/polaris";
import { InfoIcon } from "@shopify/polaris-icons";
import { useState, useEffect } from "react";
import { authenticate } from "../shopify.server.js";
import { useSubmit, useActionData } from "react-router";
import { FieldTypeSelect } from "./components/TypeFieldSelector.jsx";
import { CREATEMETAFIELDQUERY } from "./queries/metafieldQueries.jsx";
import { syncMetafield } from "./server/services/metaField.js";

export async function action({ request }) {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const formData = await request.formData();

  const name = formData.get("name");
  const description = formData.get("description");
  const type = formData.get("type");
  const ownerType = "PRODUCT";
  const isVisibleStoreFront = formData.get("isVisibleStoreFront");
  const namespacekey = formData.get("namespacekey");

  const [namespace, key] = namespacekey.split(".");

  if (!name || !type || !namespace || !key) {
    return {
      success: false,
      errors: [
        { message: "Name, Namespace.Key, Type, and Owner Type are required" },
      ],
    };
  }

  try {
    const response = await admin.graphql(CREATEMETAFIELDQUERY, {
      variables: {
        definition: {
          name,
          namespace,
          key,
          type,
          ownerType,
          description: description || "",
          access: {
            storefront: isVisibleStoreFront === "true" ? "PUBLIC_READ" : "NONE",
          },
        },
      },
    });

    const result = await response.json();
    const errors = result.data?.metafieldDefinitionCreate?.userErrors || [];

    if (errors.length > 0) {
      return { success: false, errors };
    }

    const payload = {
      shop,
      namespace,
      name,
      ownerType,
      type,
      key,
    };
    await syncMetafield(payload);
    return {
      success: true,
      metafield: result.data.metafieldDefinitionCreate.createdDefinition,
    };
  } catch (error) {
    return {
      success: false,
      errors: [{ message: error.message || "Failed to create metafield" }],
    };
  }
}

export default function AddMetaFieldsPage() {
  const submit = useSubmit();
  const actionData = useActionData();
  const [showBanner, setShowBanner] = useState(true);
  const [fieldData, setFieldData] = useState("single_line_text_field");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [namespacekey, setNamespacekey] = useState("custom.");
  const [namespaceError, setNamespaceError] = useState("");
  const [loading, setLoading] = useState(false);
  const [enabled, setEnabled] = useState(false);
  const VALID_KEY_REGEX = /^[a-z0-9_-]+\.[a-z0-9_-]+$/;

  const handleNameChange = (value) => {
    setName(value);

    if (value.trim()) {
      const formattedKey = value
        .toLowerCase()
        .trim()
        .replace(/[^a-z0-9_-\s]/g, "")
        .replace(/\s+/g, "_");

      setNamespacekey(`custom.${formattedKey}`);
      validateNamespaceKey(`custom.${formattedKey}`);
    }
  };

  const validateNamespaceKey = (value) => {
    if (!value || value === "custom.") {
      setNamespaceError("Namespace and key is required");
      return false;
    }

    if (!VALID_KEY_REGEX.test(value)) {
      setNamespaceError("Use letters, numbers, underscores, and dashes");
      return false;
    }

    const [namespace, key] = value.split(".");
    if (!namespace || !key) {
      setNamespaceError("Format must be: namespace.key");
      return false;
    }

    setNamespaceError("");
    return true;
  };

  const handleNamespaceKeyChange = (value) => {
    setNamespacekey(value);
    validateNamespaceKey(value);
  };

  const typeOptions = [
    {
      title: "Text",
      options: [
        { label: "Single line text", value: "single_line_text_field" },
        { label: "Multi-line text", value: "multi_line_text_field" },
        { label: "Rich text", value: "rich_text_field" },
      ],
    },
    {
      title: "Number",
      options: [
        { label: "Integer", value: "number_integer" },
        { label: "Decimal", value: "number_decimal" },
        { label: "Money", value: "money" },
        { label: "Rating", value: "rating" },
        { label: "Weight", value: "weight" },
        { label: "Volume", value: "volume" },
        { label: "Dimension", value: "dimension" },
      ],
    },
    {
      title: "Date & Time",
      options: [
        { label: "Date", value: "date" },
        { label: "Date & time", value: "date_time" },
      ],
    },
    {
      title: "Reference",
      options: [
        { label: "Product", value: "product_reference" },
        { label: "Product variant", value: "variant_reference" },
        { label: "Collection", value: "collection_reference" },
        { label: "Page", value: "page_reference" },
        { label: "Order", value: "order_reference" },
        { label: "Customer", value: "customer_reference" },
        { label: "Company", value: "company_reference" },
        { label: "Blog", value: "blog_reference" },
        { label: "Metaobject", value: "metaobject_reference" },
      ],
    },
    {
      title: "Other",
      options: [
        { label: "Boolean (true/false)", value: "boolean" },
        { label: "Color", value: "color" },
        { label: "URL", value: "url" },
        { label: "JSON", value: "json" },
        { label: "File", value: "file_reference" },
      ],
    },
  ];

  const handleSubmit = () => {
    if (!validateNamespaceKey(namespacekey)) {
      return;
    }
    if (!name.trim()) {
      return;
    }
    setLoading(true);
    const formData = new FormData();
    formData.append("name", name.trim());
    formData.append("description", description.trim());
    formData.append("type", fieldData);
    formData.append("namespacekey", namespacekey.toLowerCase());
    formData.append("isVisibleStoreFront", enabled.toString());

    submit(formData, { method: "post" });
  };

  // Reset form on success
  useEffect(() => {
    if (actionData?.success) {
      setLoading(false);
      setName("");
      setDescription("");
      setNamespacekey("custom.");
      setFieldData("single_line_text_field");
      setEnabled(false);
      setShowBanner(true);
    } else if (actionData?.success === false) {
      setLoading(false);
      setShowBanner(true);
    }
  }, [actionData]);

  const isFormValid =
    name.trim().length > 0 &&
    namespacekey.length > 7 && // "custom." is 7 chars
    !namespaceError;

  return (
    <Page
      fullWidth
      title="Add Metafield"
      backAction={{ url: "/app/metafields" }}
    >
      {actionData?.success && showBanner && (
        <div style={{ marginBottom: "12px" }}>
          <Banner tone="success" onDismiss={() => setShowBanner(false)}>
            <p>Metafield created successfully!</p>
          </Banner>
        </div>
      )}

      {actionData?.success === false && showBanner && (
        <Banner tone="critical" onDismiss={() => setShowBanner(false)}>
          <p>
            {actionData.errors?.[0]?.message || "Failed to create metafield"}
          </p>
        </Banner>
      )}

      <Card>
        <BlockStack gap="400">
          {/* Name Field */}
          <BlockStack gap="200">
            <TextField
              label="Name"
              value={name}
              onChange={handleNameChange}
              placeholder="e.g., Product Expiry Date"
              autoComplete="off"
              requiredIndicator
            />
          </BlockStack>

          {/* Namespace and Key */}
          <TextField
            label="Namespace and key"
            value={namespacekey}
            onChange={handleNamespaceKeyChange}
            error={namespaceError}
            helpText={
              !namespaceError
                ? "Use letters, numbers, underscores, and dashes"
                : ""
            }
            placeholder="e.g., custom.product_expiry_date"
            autoComplete="off"
            requiredIndicator
          />

          <FieldTypeSelect
            TYPE_OPTIONS={typeOptions}
            value={fieldData}
            onChange={setFieldData}
          />

          {/* Description */}
          <TextField
            label="Description"
            value={description}
            onChange={setDescription}
            placeholder="Optional description for this metafield"
            autoComplete="off"
          />

          <Card>
            <InlineStack align="space-between">
              <InlineStack gap="100" align="center">
                <Text as="h2" variant="headingSm">
                  Options
                </Text>
                <Icon source={InfoIcon} tone="subdued" />
              </InlineStack>
            </InlineStack>

            <div style={{ marginTop: "12px" }}>
              <InlineStack align="space-between" alignY="center">
                <Text>Storefront API access</Text>
                <Checkbox
                  label="Storefront API access"
                  labelHidden
                  checked={enabled}
                  onChange={setEnabled}
                />
              </InlineStack>
            </div>
          </Card>
          {/* Submit Button */}
          <Button
            variant="primary"
            loading={loading}
            fullWidth
            onClick={handleSubmit}
            disabled={!isFormValid || loading}
          >
            Add Metafield
          </Button>
        </BlockStack>
      </Card>
    </Page>
  );
}
