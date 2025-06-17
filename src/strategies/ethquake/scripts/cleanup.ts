import dotenv from 'dotenv'
import { getDb } from '../database/mongodb.js'

// Load env vars
dotenv.config()

async function cleanupRecentAddresses(minutes = 30) {
  const db = await getDb()
  const cutoffTime = new Date(Date.now() - (minutes * 60 * 1000))
  
  console.log(`Looking for addresses added after ${cutoffTime.toISOString()}`)
  
  // First count how many records we're about to delete
  const count = await db.collection('addresses_of_interest')
    .countDocuments({ created_at: { $gte: cutoffTime } })
  
  if (count === 0) {
    console.log('No addresses found to remove')
    return
  }
  
  // Ask for user confirmation
  console.log(`\nAbout to remove ${count} records, proceed? (y/n)`)
  
  // Read user input
  const readline = await import('readline')
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })
  
  const answer = await new Promise(resolve => {
    rl.question('> ', resolve)
  })
  
  rl.close()
  
  if (typeof answer === 'string' && answer.toLowerCase() !== 'y') {
    console.log('Cleanup cancelled')
    return
  }
  
  const result = await db.collection('addresses_of_interest')
    .deleteMany({ created_at: { $gte: cutoffTime } })
  
  console.log(`Removed ${result.deletedCount} addresses`)
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const minutes = parseInt(process.argv[2]) || 30
  
  let client: any // Store the MongoDB client for closing
  
  getDb()
    .then(db => {
      // Store reference to client for later closing
      client = (db as any).client
      return cleanupRecentAddresses(minutes)
    })
    .then(() => {
      console.log('Cleanup completed successfully')
    })
    .catch(err => {
      console.error('Cleanup failed:', err)
      process.exit(1)
    })
    .finally(() => {
      // Close the MongoDB connection
      if (client) {
        console.log('Closing MongoDB connection...')
        client.close()
          .then(() => console.log('MongoDB connection closed'))
          .catch((err: any) => console.error('Error closing MongoDB connection:', err))
      }
    })
}

export { cleanupRecentAddresses } 