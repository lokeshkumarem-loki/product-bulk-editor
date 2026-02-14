import { MetafieldCollection } from "../db/model";

export const syncMetafield = async (payload) => {
  const { key, namespace, shop, name, ownerType, type } = payload;

  const metafieldCollection = await MetafieldCollection();

  await metafieldCollection.updateOne(
    { shop, namespace, key },
    {
      $set: {
        name,
        ownerType,
        type,
        shop,
        namespace,
        key,
        syncedAt: new Date().toLocaleString(),
      },
    },
    { upsert: true },
  );
};
