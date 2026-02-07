export const GET_BULK_WEBHOOKS = `
query {
  webhookSubscriptions(first: 100) {
    edges {
      node {
        id
        topic
        endpoint {
          __typename
          ... on WebhookHttpEndpoint {
            callbackUrl
          }
        }
      }
    }
  }
}
`;

export const CREATE_BULK_WEBHOOK = `
mutation webhookSubscriptionCreate($callbackUrl: URL!) {
  webhookSubscriptionCreate(
    topic: BULK_OPERATIONS_FINISH
    webhookSubscription: {
      callbackUrl: $callbackUrl
      format: JSON
    }
  ) {
    webhookSubscription {
      id
    }
    userErrors {
      field
      message
    }
  }
}
`;
