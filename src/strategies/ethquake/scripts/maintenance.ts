import dotenv from 'dotenv'
import { getDb, connectToDatabase } from '@/strategies/ethquake/database/mongodb.ts'
import { fetchTransactions } from '@/lib/getTWTransactions.ts'
import { fileURLToPath } from 'url'
import path from 'path'
import readline from 'readline'

// Load env vars because apparently we need to do this in every file
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const DEFAULT_MIN_ETH = 100
const WEI_TO_ETH = 1e18
const LOOKBACK_HOURS = 1
const MIN_RANDOM_MINUTES = 10
const MAX_RANDOM_MINUTES = 480
const DEFAULT_BATCH_SIZE = 5 // Number of most recent movements to process at once

/**
 * Prompts user to select database (A or B)
 * @returns {Promise<string>} - Returns 'A' or 'B'
 */
async function promptForDatabase() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
  })

  return new Promise((resolve) => {
    rl.question('Select database (A or B): ', (answer) => {
      rl.close()
      const db = answer.toUpperCase()
      if (db !== 'A' && db !== 'B') {
        console.log('Invalid selection. Defaulting to A.')
        resolve('A')
      } else {
        resolve(db)
      }
    })
  })
}

/**
 * Gets the appropriate database connection
 * @param {string} dbType - 'A' or 'B'
 * @returns {Promise<Object>} - Database connection
 */
async function getDatabase(dbType) {
  const dbName = dbType === 'B' ? 'ethquake_b' : 'ethquake'
  console.log(`Connecting to database: ${dbName}`)
  const db = await connectToDatabase(dbName)
  console.log(`Successfully connected to database: ${dbName}`)
  
  // Verify we're connected to the correct database
  const dbStats = await db.stats()
  console.log(`Connected to database: ${dbStats.db}`)
  if (dbStats.db !== dbName) {
    throw new Error(`Connected to wrong database: ${dbStats.db} (expected: ${dbName})`)
  }
  
  return db
}

/**
 * Adds a new timestamp to the price_movements collection
 * @param {number} timestamp - UNIX timestamp of the price movement
 * @param {string} dbType - 'A' or 'B'
 */
async function addTimestamp(timestamp, dbType) {
  const db = await getDatabase(dbType)
  
  // Convert timestamp to Date object in UTC
  const date = new Date(timestamp * 1000)
  
  // Check if timestamp already exists
  const existing = await db.collection('price_movements')
    .findOne({ timestamp })
    
  if (existing) {
    console.log(`Timestamp ${timestamp} already exists in database ${dbType}`)
    return
  }
  
  // Insert new timestamp
  await db.collection('price_movements').insertOne({
    timestamp,
    date,
    processed: false,
    created_at: new Date()
  })
  
  console.log(`Added timestamp ${timestamp} (${date.toISOString()}) to price_movements collection in database ${dbType}`)
}

/**
 * Lists all timestamps in the price_movements collection
 * @param {string} dbType - 'A' or 'B'
 */
async function listAllTimestamps(dbType) {
  const db = await getDatabase(dbType)
  const timestamps = await db.collection('price_movements')
    .find({})
    .sort({ timestamp: 1 })
    .toArray()
  
  console.log(`\nAll timestamps in database ${dbType}:`)
  timestamps.forEach(ts => {
    console.log(`- ${ts.timestamp} (${new Date(ts.timestamp * 1000).toISOString()})`)
  })
  console.log(`Total: ${timestamps.length} timestamps\n`)
}

/**
 * Adds new timestamps to the price_movements collection
 * @param {string} timestamps - Comma-separated list of UNIX timestamps
 * @param {string} dbType - 'A' or 'B'
 */
async function addTimestamps(timestamps, dbType) {
  const db = await getDatabase(dbType)
  
  try {
    // First list all existing timestamps
    await listAllTimestamps(dbType)
    
    // Check if collection exists, create if it doesn't
    console.log('Checking for price_movements collection...')
    const collections = await db.listCollections().toArray()
    console.log('Existing collections:', collections.map(c => c.name))
    
    const collectionExists = collections.some(c => c.name === 'price_movements')
    console.log(`Collection exists: ${collectionExists}`)
    
    if (!collectionExists) {
      console.log(`Creating price_movements collection in database ${dbType}...`)
      await db.createCollection('price_movements')
      console.log('Collection created successfully')
    }
    
    // Split and parse timestamps
    const timestampList = timestamps.split(',').map(ts => parseInt(ts.trim()))
    console.log('Parsed timestamps:', timestampList)
    
    // Validate all timestamps
    const invalidTimestamps = timestampList.filter(ts => isNaN(ts))
    if (invalidTimestamps.length > 0) {
      throw new Error(`Invalid timestamps found: ${invalidTimestamps.join(', ')}`)
    }
    
    // Check for existing timestamps
    console.log('Checking for existing timestamps...')
    const existing = await db.collection('price_movements')
      .find({ timestamp: { $in: timestampList } })
      .toArray()
    
    console.log('Found existing timestamps:', existing.map(e => e.timestamp))
    
    const existingSet = new Set(existing.map(e => e.timestamp))
    const newTimestamps = timestampList.filter(ts => !existingSet.has(ts))
    
    if (newTimestamps.length === 0) {
      console.log(`All provided timestamps already exist in database ${dbType}`)
      return
    }
    
    // Insert new timestamps
    const documents = newTimestamps.map(timestamp => ({
      timestamp,
      date: new Date(timestamp * 1000),
      last_processed: null,
      created_at: new Date()
    }))
    
    console.log('Inserting new timestamps:', newTimestamps)
    await db.collection('price_movements').insertMany(documents)
    
    console.log(`Added ${newTimestamps.length} new timestamps to price_movements collection in database ${dbType}:`)
    newTimestamps.forEach(ts => {
      console.log(`- ${ts} (${new Date(ts * 1000).toISOString()})`)
    })
    
    // List all timestamps again after insertion
    await listAllTimestamps(dbType)
  } catch (error) {
    console.error('Error in addTimestamps:', error)
    throw error
  }
}

/**
 * Gets new addresses of interest by comparing target and control group transactions
 * @param {number} batchSize - Number of most recent movements to process
 * @param {string} dbType - 'A' or 'B'
 */
async function getNewAddresses(batchSize = DEFAULT_BATCH_SIZE, dbType) {
  const db = await getDatabase(dbType)
  
  // Get the most recent price movements, regardless of processed status
  const recentMovements = await db.collection('price_movements')
    .find()
    .sort({ timestamp: -1 })
    .limit(batchSize)
    .toArray()
    
  if (recentMovements.length === 0) {
    console.log(`No price movements found in database ${dbType}`)
    return
  }
  
  console.log(`Processing ${recentMovements.length} most recent price movements together in database ${dbType}...`)
  
  // Collect all target transactions
  const allTargetTransactions = []
  for (const movement of recentMovements) {
    console.log(`\nFetching target transactions for movement at ${new Date(movement.timestamp * 1000).toISOString()}...`)
    
    // Get target transactions (1 hour before movement)
    const targetStart = movement.timestamp - (LOOKBACK_HOURS * 3600)
    const targetEnd = movement.timestamp
    
    const targetTransactions = await fetchTransactions({
      filter_block_timestamp_gte: targetStart,
      filter_block_timestamp_lte: targetEnd
    })
    
    console.log(`Found ${targetTransactions.length} target transactions`)
    allTargetTransactions.push(...targetTransactions)
  }
  
  // Collect all control transactions
  const allControlTransactions = []
  for (const movement of recentMovements) {
    const targetStart = movement.timestamp - (LOOKBACK_HOURS * 3600)
    
    // Get three control periods for each movement
    for (let i = 0; i < 3; i++) {
      // Get control group transactions with random variation
      const randomMinutes = Math.floor(Math.random() * (MAX_RANDOM_MINUTES - MIN_RANDOM_MINUTES + 1)) + MIN_RANDOM_MINUTES
      const randomSeconds = randomMinutes * 60
      
      // Randomly decide whether to add or subtract the random time
      const randomSign = Math.random() < 0.5 ? -1 : 1
      const randomOffset = randomSign * randomSeconds
      
      const controlStart = targetStart - (24 * 3600) + randomOffset
      const controlEnd = movement.timestamp - (24 * 3600) + randomOffset
      
      console.log(`\nFetching control transactions ${i + 1}/3 (${randomSign > 0 ? '+' : '-'}${randomMinutes} minutes from 24h prior)...`)
      const controlTransactions = await fetchTransactions({
        filter_block_timestamp_gte: controlStart,
        filter_block_timestamp_lte: controlEnd
      })
      
      console.log(`Found ${controlTransactions.length} control transactions`)
      allControlTransactions.push(...controlTransactions)
    }
  }
  
  // Extract unique addresses from both groups
  const targetAddresses = new Set()
  const controlAddresses = new Set()
  
  allTargetTransactions.forEach(tx => {
    targetAddresses.add(tx.from_address)
    targetAddresses.add(tx.to_address)
  })
  
  allControlTransactions.forEach(tx => {
    controlAddresses.add(tx.from_address)
    controlAddresses.add(tx.to_address)
  })
  
  console.log(`\nFound ${targetAddresses.size} unique addresses in all target transactions`)
  console.log(`Found ${controlAddresses.size} unique addresses in all control transactions`)
  
  // Find addresses that appear in target but not in control
  const newAddresses = Array.from(targetAddresses).filter(addr => !controlAddresses.has(addr))
  
  if (newAddresses.length === 0) {
    console.log('No new addresses found across all movements')
    // Mark all movements as processed
    await db.collection('price_movements').updateMany(
      { _id: { $in: recentMovements.map(m => m._id) } },
      { $set: { last_processed: new Date() } }
    )
    console.log('All price movements marked as processed')
    return
  }
  
  console.log(`Found ${newAddresses.length} addresses that appear in target but not in control`)
  
  // Count transactions for each new address
  const addressStats = await Promise.all(newAddresses.map(async addr => {
    const sentCount = allTargetTransactions.filter(tx => tx.from_address === addr).length
    const receivedCount = allTargetTransactions.filter(tx => tx.to_address === addr).length
    
    return {
      address: addr,
      sent_count: sentCount,
      received_count: receivedCount,
      movement_count: recentMovements.length,
      created_at: new Date()
    }
  }))
  
  // Check for existing addresses
  const existingAddresses = await db.collection('addresses_of_interest')
    .find({ address: { $in: newAddresses } })
    .toArray()
  
  const existingAddressSet = new Set(existingAddresses.map(a => a.address))
  const trulyNewAddresses = addressStats.filter(stat => !existingAddressSet.has(stat.address))
  
  if (trulyNewAddresses.length > 0) {
    // Ask for user confirmation
    console.log(`\nDo you want to add ${trulyNewAddresses.length} new addresses of interest to the database? (y/n)`)
    
    // Read user input
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    const answer = await new Promise(resolve => {
      rl.question('> ', resolve)
    })
    
    rl.close()
    
    if (answer.toLowerCase() === 'y') {
      // Insert only truly new addresses
      await db.collection('addresses_of_interest').insertMany(trulyNewAddresses)
      console.log(`Added ${trulyNewAddresses.length} new addresses to addresses_of_interest collection`)
      
      // Mark all movements as processed
      await db.collection('price_movements').updateMany(
        { _id: { $in: recentMovements.map(m => m._id) } },
        { $set: { last_processed: new Date() } }
      )
      console.log('All price movements marked as processed')
    } else {
      console.log('Skipping address addition as requested - price movements will remain unprocessed')
    }
  } else {
    console.log('No new addresses to add (all found addresses already exist)')
    // Mark all movements as processed since there was nothing to add
    await db.collection('price_movements').updateMany(
      { _id: { $in: recentMovements.map(m => m._id) } },
      { $set: { last_processed: new Date() } }
    )
    console.log('All price movements marked as processed')
  }
}

// Run the appropriate command if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const command = process.argv[2]
  
  if (!command) {
    console.error('Please provide a command: add-timestamps or get-new-addresses')
    process.exit(1)
  }
  
  let client // Store the MongoDB client for closing
  
  promptForDatabase()
    .then(dbType => {
      console.log(`Using database: ethquake${dbType === 'B' ? '_b' : ''}`)
      
      if (command === 'add-timestamps') {
        const timestamps = process.argv[3]
        if (!timestamps) {
          throw new Error('Please provide comma-separated timestamps')
        }
        return addTimestamps(timestamps, dbType)
      } else if (command === 'get-new-addresses') {
        const batchSize = parseInt(process.argv[3]) || DEFAULT_BATCH_SIZE
        return getNewAddresses(batchSize, dbType)
      } else {
        throw new Error(`Unknown command: ${command}`)
      }
    })
    .then(() => {
      console.log('Command completed successfully')
    })
    .catch(err => {
      console.error('Command failed:', err)
      process.exit(1)
    })
    .finally(() => {
      // Close the MongoDB connection to allow the process to exit
      if (client) {
        console.log('Closing MongoDB connection...')
        client.close()
          .then(() => console.log('MongoDB connection closed'))
          .catch(err => console.error('Error closing MongoDB connection:', err))
      }
    })
}

export { addTimestamps, getNewAddresses } 