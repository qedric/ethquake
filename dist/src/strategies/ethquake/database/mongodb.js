import dotenv from 'dotenv';
import { MongoClient } from 'mongodb';
// Only load .env in development
if (process.env.NODE_ENV !== 'production') {
    dotenv.config();
}
if (!process.env.MONGODB_URI) {
    throw new Error('Invalid/Missing environment variable: "MONGODB_URI"');
}
const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const defaultDbName = process.env.MONGO_DB_NAME || 'ethquake';
let client = null;
let db = null;
/**
 * Connects to MongoDB and returns a database instance
 * @param {string} [dbName] - Optional database name. If not provided, uses default from env
 * @returns {Promise<Db>} - Database instance
 */
async function connectToDatabase(dbName = defaultDbName) {
    try {
        console.log(`Connecting to MongoDB database: ${dbName}...`);
        client = new MongoClient(uri, {
            connectTimeoutMS: 5000,
            socketTimeoutMS: 30000,
            retryWrites: true,
            retryReads: true
        });
        await client.connect();
        console.log('Successfully connected to MongoDB');
        db = client.db(dbName);
        return db;
    }
    catch (error) {
        console.error('Failed to connect to MongoDB:', error);
        throw error;
    }
}
/**
 * Gets the default database instance
 * @returns {Promise<Db>} - Database instance
 */
async function getDb() {
    if (!db) {
        db = await connectToDatabase();
    }
    return db;
}
async function logActivity(activity) {
    try {
        const db = await getDb();
        await db.collection('activity_log').insertOne({
            ...activity,
            timestamp: new Date()
        });
    }
    catch (error) {
        console.error('Failed to log activity:', error);
        // Don't throw here - we don't want logging failures to break the app
    }
}
// Usage example: logActivity({ type: 'TRANSACTION_FETCH', count: transactions.length })
export { getDb, connectToDatabase, logActivity, client };
