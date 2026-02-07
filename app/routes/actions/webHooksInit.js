import {
  GET_BULK_WEBHOOKS,
  CREATE_BULK_WEBHOOK,
} from "../queries/webHookQueries";

export async function ensureBulkFinishWebhook(admin, callbackUrl) {
  // Fetch existing webhooks
  const res = await admin.graphql(GET_BULK_WEBHOOKS);
  const json = await res.json();

  const existing = json.data.webhookSubscriptions.edges.find(
    ({ node }) =>
      node.topic === "BULK_OPERATIONS_FINISH" &&
      node.endpoint?.callbackUrl === callbackUrl,
  );

  // If already exists → do nothing
  if (existing) {
    return {
      created: false,
      webhookId: existing.node.id,
    };
  }

  //  Otherwise create webhook
  const createRes = await admin.graphql(CREATE_BULK_WEBHOOK, {
    variables: { callbackUrl },
  });

  const createJson = await createRes.json();
  const errors = createJson.data.webhookSubscriptionCreate.userErrors;

  if (errors?.length) {
    throw new Error(errors[0].message);
  }

  return {
    created: true,
    webhookId: createJson.data.webhookSubscriptionCreate.webhookSubscription.id,
  };
}
