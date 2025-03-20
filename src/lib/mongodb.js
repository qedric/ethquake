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

if (process.env.NODE_ENV === 'development') {
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

// Instead of using global, use a module-level variable
let cachedClient = null
let cachedDb = null

export async function getDbClient() {
  if (cachedClient) {
    return { client: cachedClient, db: cachedDb }
  }

  // Connect to MongoDB
  const client = new MongoClient(process.env.MONGODB_URI)
  await client.connect()
  const db = client.db('ethquake')
  
  // Cache the connection
  cachedClient = client
  cachedDb = db
  
  return { client, db }
}

export { client }