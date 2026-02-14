export const CREATEMETAFIELDQUERY = `
  mutation CreateMetafieldDefinition($definition: MetafieldDefinitionInput!) {
  metafieldDefinitionCreate(definition: $definition) {
    createdDefinition {
      id
      name
      namespace
      key
      type {
        name
      }
      ownerType
      description
      access {
        storefront
      }
    }
    userErrors {
      field
      message
      code
    }
  }
}
`;

export const ADDMETAFIELDQUERY = `
  mutation SetProductMetafield($ownerId: ID!, $namespace: String!, $key: String!, $value: String!, $type: String!) {
    metafieldsSet(metafields: [{
      ownerId: $ownerId
      namespace: $namespace
      key: $key
      value: $value
      type: $type
    }]) {
      metafields {
        id
        namespace
        key
        value
        type
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;
