import { MetafieldCollection } from "../db/model";

export const updateMetafieldsInDB = async (
  shop,
  ownerId,
  ownerType,
  metafields = [],
) => {
  if (!shop || !ownerId || !ownerType)
    throw new Error("Shop, ownerId, and ownerType required");
  if (!Array.isArray(metafields) || metafields.length === 0) return;

  const metafieldCollection = await MetafieldCollection();

  const ops = metafields.map((mf) => ({
    updateOne: {
      filter: { shop, ownerId, ownerType, key: mf.key },
      update: {
        $set: {
          namespace: mf.namespace || null,
          value: mf.value || null,
          type: mf.type || null,
          syncedAt: new Date(),
        },
      },
      upsert: true,
    },
  }));

  await metafieldCollection.bulkWrite(ops);
};
    