import { connectDB } from "./mango.js";

export async function StoreCollection() {
  const db = await connectDB();
  return db.collection("store");
}

export async function ProductCollection() {
  const db = await connectDB();
  return db.collection("product");
}

export async function VariantCollection() {
  const db = await connectDB();
  return db.collection("varient");
}

export async function MetafieldCollection() {
  const db = await connectDB();
  return db.collection("metafield");
}
