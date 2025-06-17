import dotenv from 'dotenv'
import { connectToDatabase } from '../database/mongodb.js'
import { fetchTransactions } from '../../../lib/getTWTransactions.js'
import readline from 'readline'

// Load env vars because apparently we need to do this in every file
dotenv.config()

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
async function getDatabase(dbType: 'A' | 'B') {
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
async function addTimestamp(timestamp: number, dbType: 'A' | 'B') {
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
async function listAllTimestamps(dbType: 'A' | 'B') {
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
 * Gets new addresses of interest by comparing target and control group transactions
 * @param {number} batchSize - Number of most recent movements to process
 * @param {string} dbType - 'A' or 'B'
 */
async function getNewAddresses(batchSize = DEFAULT_BATCH_SIZE, dbType: 'A' | 'B') {
  const db = await getDatabase(dbType)
  
  // Get the most recent price movements, regardless of processed status
  const priceMovements = await db.collection('price_movements')
    .find({})
    .sort({ timestamp: -1 })
    .limit(batchSize)
    .toArray()

  if (priceMovements.length === 0) {
    console.log(`No price movements found in database ${dbType}`)
    return
  }

  console.log(`Processing ${priceMovements.length} most recent price movements together in database ${dbType}...`)

  // Convert min ETH to Wei for the API
  const minWeiValue = BigInt(DEFAULT_MIN_ETH) * BigInt(WEI_TO_ETH)

  // Collect all target transactions
  const allTargetTransactions: any[] = []
  for (const movement of priceMovements) {
    console.log(`\nFetching target transactions for movement at ${new Date(movement.timestamp * 1000).toISOString()}...`)
    
    // Get target transactions (1 hour before movement)
    const targetStart = movement.timestamp - (LOOKBACK_HOURS * 3600)
    const targetEnd = movement.timestamp
    
    const targetTransactions = await fetchTransactions({
      filter_block_timestamp_gte: targetStart,
      filter_block_timestamp_lte: targetEnd,
      filter_value_gte: minWeiValue.toString()
    })
    
    console.log(`Found ${targetTransactions.length} target transactions`)
    allTargetTransactions.push(...targetTransactions)
  }

  // Collect all control transactions
  const allControlTransactions = []
  for (const movement of priceMovements) {
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
        filter_block_timestamp_lte: controlEnd,
        filter_value_gte: minWeiValue.toString()
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
      { _id: { $in: priceMovements.map(m => m._id) } },
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
      movement_count: priceMovements.length,
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
    
    const answer = await new Promise<string>(resolve => {
      rl.question('> ', resolve)
    })
    
    rl.close()
    
    if (answer.toLowerCase() === 'y') {
      // Insert only truly new addresses
      await db.collection('addresses_of_interest').insertMany(trulyNewAddresses)
      console.log(`Added ${trulyNewAddresses.length} new addresses to addresses_of_interest collection`)
      
      // Mark all movements as processed
      await db.collection('price_movements').updateMany(
        { _id: { $in: priceMovements.map(m => m._id) } },
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
      { _id: { $in: priceMovements.map(m => m._id) } },
      { $set: { last_processed: new Date() } }
    )
    console.log('All price movements marked as processed')
  }
}

// Export functions
export {
  promptForDatabase,
  addTimestamp,
  getNewAddresses,
  listAllTimestamps
} 