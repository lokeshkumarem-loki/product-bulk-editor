export const FETCH_PRODUCTS = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      products {
        edges {
          node {
            id
            title
            handle
            status
            vendor
            productType
            tags
            category { name }
            featuredImage {
              url
            }
            collections {
              edges {
                node {
                  id
                  title
                  handle
                }
              }
            }
          }
        }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
`;

export const FETCH_VARIANTS = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      products {
        edges {
          node {
            id
            variants {
              edges {
                node {
                  id
                  title
                  sku
                  price
                  compareAtPrice
                  availableForSale
                  inventoryQuantity
                  selectedOptions { name value }
                  image { url }
                }
              }
            }
          }
        }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
`;

export const FETCH_METAFIELDS = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      products {
        edges {
          node {
            id
            metafields {
              edges {
                node {
                  id
                  namespace
                  key
                  value
                  type
                }
              }
            }
          }
        }
      }
    }
    """
  ) {
    bulkOperation { id status }
    userErrors { field message }
  }
}
`;

export const getQueryStatus = (operationId) => `
  query {
    node(id: "${operationId}") {
      ... on BulkOperation {
        id
        status
        errorCode
        createdAt
        completedAt
        objectCount
        fileSize
        url
        partialDataUrl
      }
    }
  }
`;

// Alternative query that returns current running operation
export const GET_CURRENT_BULK_OPERATION = `
  query {
    currentBulkOperation {
      id
      status
      errorCode
      createdAt
      completedAt
      objectCount
      fileSize
      url
      partialDataUrl
    }
  }
`;

// Cancel a bulk operation
export const cancelBulkOperation = (operationId) => `
  mutation {
    bulkOperationCancel(id: "${operationId}") {
      bulkOperation {
        id
        status
      }
      userErrors {
        field
        message
      }
    }
  }
`;
