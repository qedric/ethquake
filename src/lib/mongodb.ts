import dotenv from 'dotenv'
import { MongoClient, Db } from 'mongodb'

// Only load .env in development
if (process.env.NODE_ENV !== 'production') {
  dotenv.config()
}

if (!process.env.MONGODB_URI) {
  throw new Error('Invalid/Missing environment variable: "MONGODB_URI"')
}

const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017'
const dbConnections: Map<string, Db> = new Map()
let client: MongoClient | null = null

/**
 * Connects to MongoDB and returns a database instance
 * @param {string} dbName - Database name to connect to
 * @returns {Promise<Db>} - Database instance
 */
async function connectToDatabase(dbName: string): Promise<Db> {
  try {
    console.log(`Connecting to MongoDB database: ${dbName}...`)
    
    // Reuse existing client if we have one
    if (!client) {
      client = new MongoClient(uri, {
        connectTimeoutMS: 5000,
        socketTimeoutMS: 30000,
        retryWrites: true,
        retryReads: true
      })
      await client.connect()
      console.log('Successfully connected to MongoDB')
    }
    
    const db = client.db(dbName)
    dbConnections.set(dbName, db)
    return db
  } catch (error) {
    console.error('Failed to connect to MongoDB:', error)
    throw error
  }
}

/**
 * Gets a database instance by name
 * @param {string} dbName - Database name to get
 * @returns {Promise<Db>} - Database instance
 */
async function getDb(dbName: string): Promise<Db> {
  const existingDb = dbConnections.get(dbName)
  if (existingDb) {
    return existingDb
  }
  return await connectToDatabase(dbName)
}

/**
 * Logs activity to the specified database's activity_log collection
 * @param {string} dbName - Database name to log to
 * @param {Record<string, any>} activity - Activity data to log
 */
async function logActivity(dbName: string, activity: Record<string, any>) {
  try {
    const db = await getDb(dbName)
    await db.collection('activity_log').insertOne({
      ...activity,
      timestamp: new Date()
    })
  } catch (error) {
    console.error('Failed to log activity:', error)
    // Don't throw here - we don't want logging failures to break the app
  }
}

export { getDb, connectToDatabase, logActivity, client } 