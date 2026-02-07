import { MongoClient } from "mongodb";

const uri = process.env.MONGODB_URI;

const client = new MongoClient(uri, {
  tls: true,
  serverSelectionTimeoutMS: 5000,
});

let db;

export async function connectDB() {
  if (db) return db;

  await client.connect();
  db = client.db(); // DB name comes from URI now
  return db;
}
