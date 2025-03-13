import dotenv from 'dotenv'
import { MongoClient } from 'mongodb'
import path from 'path'

console.log('Current working directory:', process.cwd())
console.log('.env file should be at:', path.join(process.cwd(), '.env'))

dotenv.config()

console.log('MONGODB_URI set?', !!process.env.MONGODB_URI)

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
}

const uri = process.env.MONGODB_URI

let client

if (process.env.NODE_ENV === "development") {
  // Reuse connection in development
  if (!global._mongoClient) {
    global._mongoClient = new MongoClient(uri, {})
  }
  client = global._mongoClient
} else {
  client = new MongoClient(uri, {})
}

export { client }