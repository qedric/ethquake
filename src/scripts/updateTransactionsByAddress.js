import dotenv from 'dotenv'
import { fetchTransactions } from '../lib/getTWTransactions.js'
import { getDb } from '../lib/mongodb.js'
import { getBlockNumberFromTimestamp } from '../lib/getBlockNumberFromTimestamp.js'

/**
 * Updates transactions for addresses of interest by fetching new ones since the latest block in the existing data.
 * 
 * Usage via CLI:
 *   node scripts/updateTransactionsByAddress.js [minEthValue] [startBlockNumber]
 * 
 * Examples:
 *   node scripts/updateTransactionsByAddress.js
 *     - Uses default minimum ETH value: 100
 *     - Continues from latest block in database
 *   
 *   node scripts/updateTransactionsByAddress.js 200
 *     - Only includes transactions of 200+ ETH
 *     - Continues from latest block in database
 *
 *   node scripts/updateTransactionsByAddress.js 100 15000000
 *     - Uses default minimum ETH value: 100
 *     - Starts fetching from block 15000000
 * 
 * Usage via import:
 *   import { updateTransactionsByAddressesOfInterest } from './updateTransactionsByAddress.js'
 *   
 *   // Update transactions with default parameters
 *   await updateTransactionsByAddressesOfInterest()
 *   
 *   // Update transactions with custom parameters
 *   await updateTransactionsByAddressesOfInterest(150)
 *
 *   // Update transactions starting from specific block
 *   await updateTransactionsByAddressesOfInterest(100, 15000000)
 */

// Loading env vars because for some reason we still can't organize config properly
dotenv.config()

const DEFAULT_MIN_ETH = 100
const WEI_TO_ETH = 1e18

/**
 * Updates transactions for addresses of interest by fetching new ones since the specified block
 * 
 * @param {number} minEthValue - Minimum transaction value in ETH to include
 * @param {number} [fromTimestamp] - Optional start timestamp in seconds
 * @param {number} [toTimestamp] - Optional end timestamp in seconds
 * @param {Object} [existingDb] - Optional existing MongoDB connection
 * @returns {Object} Object containing counts of all transactions and new transactions added
 */
async function updateTransactionsByAddressesOfInterest(
  minEthValue = DEFAULT_MIN_ETH,
  fromTimestamp = null,
  toTimestamp = null,
  existingDb = null
) {
  // Get MongoDB connection
  const db = existingDb || await getDb()
  const shouldCloseConnection = !existingDb
  
  // Load existing transaction data from MongoDB
  console.log('Reading existing transaction data from MongoDB...')
  let existingTransactions = []
  
  try {
    existingTransactions = await db.collection('transactions').find({}).toArray()
    console.log(`Found ${existingTransactions.length} existing transactions.`)
  } catch (error) {
    console.error('Error fetching transactions from MongoDB:', error)
    throw new Error(`Failed to read existing transactions: ${error.message}`)
  }

  // Determine block numbers from timestamps if provided
  let startBlockNumber = null
  let endBlockNumber = null
  
  if (fromTimestamp) {
    startBlockNumber = await getBlockNumberFromTimestamp(fromTimestamp)
    console.log(`Using start block number ${startBlockNumber} (from timestamp ${fromTimestamp})`)
  } else if (existingTransactions.length > 0) {
    // Find the highest block_number from existing transactions
    startBlockNumber = Math.max(...existingTransactions.map(tx => parseInt(tx.block_number)))
    console.log(`Latest block number in existing data: ${startBlockNumber}`)
  } else {
    // If there are no transactions yet and no start timestamp was provided, we need to abort
    console.log('No existing transactions found in MongoDB and no start timestamp provided.')
    throw new Error('Cannot determine start block. Please provide a start timestamp.')
  }

  if (toTimestamp) {
    endBlockNumber = await getBlockNumberFromTimestamp(toTimestamp)
    console.log(`Using end block number ${endBlockNumber} (from timestamp ${toTimestamp})`)
  }

  // Load addresses of interest from MongoDB
  let addressesOfInterest = []
  
  try {
    addressesOfInterest = await db.collection('addresses_of_interest').find({}).toArray()
    addressesOfInterest = addressesOfInterest.map(item => item.address)
    console.log(`Loaded ${addressesOfInterest.length} addresses of interest.`)
  } catch (error) {
    console.error('Error fetching addresses of interest from MongoDB:', error)
    throw new Error(`Failed to load addresses of interest: ${error.message}`)
  }

  if (addressesOfInterest.length === 0) {
    throw new Error('No addresses of interest found in MongoDB. Nothing to update.')
  }

  // Fetch new transactions for all addresses
  console.log(`Fetching new transactions since block ${startBlockNumber} to ${endBlockNumber} for ${addressesOfInterest.length} addresses...`)
  
  const minWeiValue = BigInt(minEthValue) * BigInt(WEI_TO_ETH)
  let newTransactions = []
  
  // Process addresses in chunks because the API has limits
  const chunkSize = 50
  let processedAddressesCount = 0
  
  // Clear line and write initial status
  process.stdout.write('\r\x1b[K') // Clear the current line
  process.stdout.write(`Processing addresses: 0/${addressesOfInterest.length} | New transactions: 0`)
  
  for (let i = 0; i < addressesOfInterest.length; i += chunkSize) {
    const addressesChunk = addressesOfInterest.slice(i, i + chunkSize)
    const chunkPromises = []
    
    for (const address of addressesChunk) {
      if (!address) continue // Skip empty addresses because apparently that's a thing

      // Need to check for both sending and receiving transactions
      const fromPromise = fetchTransactions({
        filter_from_address: address,
        filter_block_number_gt: startBlockNumber,
        filter_block_number_lte: endBlockNumber,
        filter_value_gte: minWeiValue.toString()
      }).then(txs => txs.map(tx => ({
        hash: tx.hash,
        block_number: tx.block_number,
        block_timestamp: tx.block_timestamp,
        from_address: tx.from_address,
        to_address: tx.to_address,
        txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
        value: tx.value,
        valueInEth: Number(tx.value) / (10 ** 18),
        addressOfInterest: address,
        direction: 'sent'
      })))
      
      const toPromise = fetchTransactions({
        filter_to_address: address,
        filter_block_number_gt: startBlockNumber,
        filter_block_number_lte: endBlockNumber,
        filter_value_gte: minWeiValue.toString()
      }).then(txs => txs.map(tx => ({
        hash: tx.hash,
        block_number: tx.block_number,
        block_timestamp: tx.block_timestamp,
        from_address: tx.from_address,
        to_address: tx.to_address,
        txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
        value: tx.value,
        valueInEth: Number(tx.value) / (10 ** 18),
        addressOfInterest: address,
        direction: 'received'
      })))
      
      chunkPromises.push(fromPromise, toPromise)
    }
    
    // Process this chunk
    const chunkResults = await Promise.all(chunkPromises)
    chunkResults.forEach(txs => {
      newTransactions = newTransactions.concat(txs)
    })
    
    processedAddressesCount += addressesChunk.length
    
    // Update the status line with current progress
    process.stdout.write('\r\x1b[K') // Clear the current line
    process.stdout.write(`Processing addresses: ${processedAddressesCount}/${addressesOfInterest.length} | New transactions: ${newTransactions.length}`)
    
    // Wait 1 second before processing the next chunk to avoid rate limiting
    if (i + chunkSize < addressesOfInterest.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }
  
  // Move to new line after the progress updates
  console.log('')
  console.log(`\nFetched ${newTransactions.length} total new transactions.`)
  
  // Remove duplicates using a Map with transaction hash as key
  const transactionMap = new Map()
  
  // First add existing transactions to the map
  for (const tx of existingTransactions) {
    transactionMap.set(tx.hash, tx)
  }
  
  // Add new unique transactions to the map
  let newUniqueCount = 0
  for (const tx of newTransactions) {
    if (!transactionMap.has(tx.hash)) {
      transactionMap.set(tx.hash, tx)
      newUniqueCount++
    }
  }
  
  console.log(`Added ${newUniqueCount} new unique transactions.`)
  
  // Only save the new unique transactions to save time
  if (newUniqueCount > 0) {
    const newUniqueTxs = newTransactions.filter(tx => !existingTransactions.some(e => e.hash === tx.hash))
    await saveTransactionsToMongo(newUniqueTxs)
  } else {
    console.log('No new transactions to save.')
  }
  
  return {
    allTransactionsCount: transactionMap.size,
    newTransactionsCount: newUniqueCount
  }
}

async function saveTransactionsToMongo(transactions, collectionName = 'transactions') {
  try {
    const db = await getDb()
    const collection = db.collection(collectionName)
    
    // Create a bulk operation
    const operations = transactions.map(tx => ({
      updateOne: {
        filter: { hash: tx.hash },
        update: { 
          $set: {
            ...tx,
            value_in_eth: parseFloat((tx.value / 1e18).toFixed(6)),
            block_datetime: new Date(tx.block_timestamp * 1000),
            updated_at: new Date()
          } 
        },
        upsert: true
      }
    }))
    
    if (operations.length > 0) {
      const result = await collection.bulkWrite(operations)
      console.log(`MongoDB: ${result.upsertedCount} new transactions, ${result.modifiedCount} updated`)
    }
    
    return transactions
  } catch (error) {
    console.error('Error saving to MongoDB:', error)
    throw error
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const minEthValue = process.argv[2] ? parseInt(process.argv[2]) : DEFAULT_MIN_ETH
  const fromTimestamp = process.argv[3] ? parseInt(process.argv[3]) : null
  const toTimestamp = process.argv[4] ? parseInt(process.argv[4]) : null
  
  let client // Store the MongoDB client for closing
  
  getDb()
    .then(db => {
      // Store reference to client for later closing
      client = db.client
      return updateTransactionsByAddressesOfInterest(minEthValue, fromTimestamp, toTimestamp, db)
    })
    .then(({ newTransactionsCount, allTransactionsCount }) => {
      console.log(`Done! Added ${newTransactionsCount} new transactions. Total: ${allTransactionsCount}`)
    })
    .catch(err => {
      console.error('Failed to update transactions:', err)
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

export { updateTransactionsByAddressesOfInterest }
