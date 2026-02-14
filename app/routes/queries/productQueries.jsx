export const CURRENCY_CODE_QUERY = `
{
  shop {
    currencyCode
  }
}
`;

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
            createdAt
            updatedAt
            category {
              name
            }
            featuredImage {
              url
            }
            variants {
              edges {
                node {
                  id
                  title
                  price
                  compareAtPrice
                  image {
                    url
                  }
                }
              }
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

export const FETCH_METAFIELD_DEFINITIONS = `
mutation {
  bulkOperationRunQuery(
    query: """
    {
      metafieldDefinitions(ownerType: PRODUCT, first: 250) {
        edges {
          node {
            id
            name
            namespace
            key
            type {
              name
            }
          }
        }
      }
    }
    """
  ) {
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

export const FETCH_VARIANTS = FETCH_PRODUCTS;

export const FETCH_METAFIELDS = FETCH_METAFIELD_DEFINITIONS;
