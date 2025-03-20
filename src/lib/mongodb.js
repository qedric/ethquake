import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'

// Only load .env in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config()
}

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
}

const uri = process.env.MONGODB_URI
let client
let clientPromise

if (process.env.NODE_ENV === "development") {
  // Reuse connection in development
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri)
    global._mongoClientPromise = client.connect()
  }
  clientPromise = global._mongoClientPromise
} else {
  // Create new connection in production
  client = new MongoClient(uri)
  clientPromise = client.connect()
}

// Helper function to get the database
export async function getDbClient() {
  const connectedClient = await clientPromise
  return connectedClient.db()
}

export { client }