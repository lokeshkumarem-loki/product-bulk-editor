import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;
if (!uri) throw new Error("MONGODB_URI missing");

let client;
let db;

if (!global._mongoClient) {
  global._mongoClient = new MongoClient(uri, {
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
  });
}

client = global._mongoClient;

export async function connectDB() {
  if (db) return db;

  try {
    await client.connect();
    db = client.db("bulk_product_editor");
    return db;
  } catch (error) {
    console.error("MongoDB connection error:", error.message);
    throw error;
  }
}
