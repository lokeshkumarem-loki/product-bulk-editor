export const CREATEMETAFIELDQUERY = `
  mutation metafieldDefinitionCreate($definition: MetafieldDefinitionInput!) {
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
      }
      userErrors {
        field
        message
      }
    }
  }
`;
