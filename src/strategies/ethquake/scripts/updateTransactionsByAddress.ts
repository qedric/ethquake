import dotenv from 'dotenv'
import { getDb } from '../../../lib/mongodb.js'
import { fetchTransactions } from '../../../lib/getTWTransactions.js'
import { MongoClient } from 'mongodb'
import { selectDatabase } from '../database/dbSelector.js'

/**
 * Updates transactions for addresses of interest by fetching new ones since the latest block in the existing data.
 * 
 * Usage via CLI:
 *   node scripts/updateTransactionsByAddress.ts [minEthValue] [startBlockNumber]
 * 
 * Examples:
 *   node scripts/updateTransactionsByAddress.ts
 *     - Uses default minimum ETH value: 100
 *     - Continues from latest block in database
 *   
 *   node scripts/updateTransactionsByAddress.ts 200
 *     - Only includes transactions of 200+ ETH
 *     - Continues from latest block in database
 *
 *   node scripts/updateTransactionsByAddress.ts 100 15000000
 *     - Uses default minimum ETH value: 100
 *     - Starts fetching from block 15000000
 * 
 * Usage via import:
 *   import { updateTransactionsByAddressesOfInterest } from './updateTransactionsByAddress'
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
const API_LIMIT = 200
const DEFAULT_OVERLAP_SECONDS = parseInt(process.env.INGEST_OVERLAP_S || '600')

type AddressDoc = {
  address: string
  last_seen_ts?: number
}

type TWTransaction = {
  hash: string
  block_number: number
  block_timestamp: number
  from_address: string
  to_address: string
  value: string | number
}

/**
 * Updates transactions for addresses of interest using timestamp-based polling with overlap and pagination
 * 
 * @param {number} minEthValue - Minimum transaction value in ETH to include
 * @param {number} [fromTimestamp] - Optional start timestamp in seconds
 * @param {number} [toTimestamp] - Optional end timestamp in seconds
 * @param {Object} [existingDb] - Optional existing MongoDB connection
 * @returns {Object} Object containing counts of all transactions and new transactions added
 */
async function updateTransactionsByAddressesOfInterest({
  minEthValue = DEFAULT_MIN_ETH,
  fromTimestamp = null,
  toTimestamp = null,
  existingDb = null,
  existingClient = null
}: {
  minEthValue?: number
  fromTimestamp?: number | null
  toTimestamp?: number | null
  existingDb?: any
  existingClient?: MongoClient | null
} = {}) {
  // Get MongoDB connection
  let db
  let client = existingClient
  const shouldCloseConnection = !existingDb

  if (existingDb) {
    db = existingDb
  } else {
    const dbName = await selectDatabase()
    db = await getDb(dbName)
    client = (db as any).client
  }

  console.log(`Using database: ${db.databaseName}`)

  try {
    console.log('[Strategy: ethquake] fromTimestamp:', fromTimestamp)
    console.log('[Strategy: ethquake] toTimestamp:', toTimestamp)

    // Load existing transactions once to build per-address watermarks without N queries
    console.log('[Strategy: ethquake] Reading existing transaction data from MongoDB...')
    const existingTransactions = await db.collection('transactions').find({}).toArray()
    console.log(`[Strategy: ethquake] Found ${existingTransactions.length} existing transactions.`)

    // Build per-address last seen timestamps from existing transactions
    const addressLastSeenTs = new Map<string, number>()
    for (const tx of existingTransactions as Array<any>) {
      const ts = typeof tx.block_timestamp === 'number' ? tx.block_timestamp : 0
      if (tx.from_address) {
        const a = String(tx.from_address).toLowerCase()
        const prev = addressLastSeenTs.get(a) || 0
        if (ts > prev) addressLastSeenTs.set(a, ts)
      }
      if (tx.to_address) {
        const a = String(tx.to_address).toLowerCase()
        const prev = addressLastSeenTs.get(a) || 0
        if (ts > prev) addressLastSeenTs.set(a, ts)
      }
    }

    // Load addresses of interest
    const addressDocs = await db.collection('addresses_of_interest').find({}).toArray() as AddressDoc[]
    const addressesOfInterest = addressDocs.map(d => d.address).filter(Boolean)
    console.log(`[Strategy: ethquake] Loaded ${addressesOfInterest.length} addresses of interest.`)

    if (addressesOfInterest.length === 0) throw new Error('No addresses of interest found in MongoDB. Nothing to update.')

    const minWeiValue = BigInt(minEthValue) * BigInt(WEI_TO_ETH)
    let newTransactions: Array<{
      hash: string
      block_number: number
      block_timestamp: number
      from_address: string
      to_address: string
      txDateTime: string
      value: string | number
      valueInEth: number
      addressOfInterest: string
      direction: 'sent' | 'received'
    }> = []

    const overlap = DEFAULT_OVERLAP_SECONDS
    const nowSec = Math.floor(Date.now() / 1000)
    const globalEndTs = toTimestamp ?? nowSec

    // Helper to fetch all pages for an address and a direction
    const fetchPagedFor = async (params: Record<string, string | number>) => {
      const total: TWTransaction[] = []
      const pageDelayMs = parseInt(process.env.INGEST_PAGE_DELAY_MS || '200')
      for (let page = 0; page <= 500; page++) {
        const txs = await fetchTransactions({ ...params, page }) as TWTransaction[]
        total.push(...txs)
        if (!txs || txs.length < API_LIMIT) break
        if (pageDelayMs > 0) await new Promise(r => setTimeout(r, pageDelayMs))
      }
      return total
    }

    // Process addresses in chunks
    const chunkSize = parseInt(process.env.INGEST_CHUNK_SIZE || '10')
    let processedAddressesCount = 0
    process.stdout.write('\r\x1b[K')
    process.stdout.write(`[Strategy: ethquake] Processing addresses: 0/${addressesOfInterest.length} | New transactions: 0. `)

    for (let i = 0; i < addressesOfInterest.length; i += chunkSize) {
      const addressesChunk = addressesOfInterest.slice(i, i + chunkSize)

      const chunkPromises = addressesChunk.map(async rawAddr => {
        const address = rawAddr.toLowerCase()
        const addrLastSeen = addressLastSeenTs.get(address) || 0
        const startTsBase = fromTimestamp ?? addrLastSeen
        const startTs = Math.max(0, startTsBase - overlap)

        const baseFilters = {
          filter_block_timestamp_gte: startTs,
          filter_block_timestamp_lte: globalEndTs,
          filter_value_gte: (minWeiValue as bigint).toString()
        }

        const sent = await fetchPagedFor({ ...baseFilters, filter_from_address: address })
        const received = await fetchPagedFor({ ...baseFilters, filter_to_address: address })

        const mappedSent = sent.map(tx => ({
          hash: tx.hash,
          block_number: Number(tx.block_number),
          block_timestamp: Number(tx.block_timestamp),
          from_address: tx.from_address,
          to_address: tx.to_address,
          txDateTime: new Date(Number(tx.block_timestamp) * 1000).toISOString(),
          value: tx.value,
          valueInEth: Number(tx.value) / (10 ** 18),
          addressOfInterest: address,
          direction: 'sent' as const
        }))

        const mappedReceived = received.map(tx => ({
          hash: tx.hash,
          block_number: Number(tx.block_number),
          block_timestamp: Number(tx.block_timestamp),
          from_address: tx.from_address,
          to_address: tx.to_address,
          txDateTime: new Date(Number(tx.block_timestamp) * 1000).toISOString(),
          value: tx.value,
          valueInEth: Number(tx.value) / (10 ** 18),
          addressOfInterest: address,
          direction: 'received' as const
        }))

        return [...mappedSent, ...mappedReceived]
      })

      const chunkResults = await Promise.all(chunkPromises)
      for (const arr of chunkResults) newTransactions.push(...arr)

      processedAddressesCount += addressesChunk.length
      process.stdout.write('\r\x1b[K')
      process.stdout.write(`[Strategy: ethquake] Processing addresses: ${processedAddressesCount}/${addressesOfInterest.length} | New transactions: ${newTransactions.length}. `)

      if (i + chunkSize < addressesOfInterest.length) await new Promise(resolve => setTimeout(resolve, 1000))
    }

    console.log('')
    console.log(`\nFetched ${newTransactions.length} total new transactions.`)

    // Dedupe by hash against existing
    const existingHashes = new Set((existingTransactions as Array<any>).map(t => t.hash))
    const newUniqueTxs = newTransactions.filter(t => !existingHashes.has(t.hash))
    console.log(`Added ${newUniqueTxs.length} new unique transactions.`)

    if (newUniqueTxs.length > 0) await saveTransactionsToMongo(newUniqueTxs as any[], db)
    else console.log('No new transactions to save.')

    // Update per-address watermarks based on newly seen data
    const maxTsByAddress = new Map<string, number>()
    for (const tx of newTransactions) {
      const aFrom = tx.from_address?.toLowerCase()
      const aTo = tx.to_address?.toLowerCase()
      if (aFrom) {
        const prev = maxTsByAddress.get(aFrom) || 0
        if (tx.block_timestamp > prev) maxTsByAddress.set(aFrom, tx.block_timestamp)
      }
      if (aTo) {
        const prev = maxTsByAddress.get(aTo) || 0
        if (tx.block_timestamp > prev) maxTsByAddress.set(aTo, tx.block_timestamp)
      }
    }

    if (maxTsByAddress.size > 0) {
      const ops: any[] = []
      for (const [addr, ts] of maxTsByAddress.entries()) {
        ops.push({
          updateOne: {
            filter: { address: addr },
            update: { $set: { last_seen_ts: ts, last_polled_at: new Date() } },
            upsert: false
          }
        })
      }
      if (ops.length > 0) await db.collection('addresses_of_interest').bulkWrite(ops)
    }

    return {
      allTransactionsCount: (existingTransactions.length + newUniqueTxs.length),
      newTransactionsCount: newUniqueTxs.length
    }
  } finally {
    // Close MongoDB connection if we opened it
    if (shouldCloseConnection && client) {
      await client.close()
      console.log('Closed MongoDB connection')
    }
  }
}

async function saveTransactionsToMongo(transactions: any[], db: any, collectionName = 'transactions') {
  try {
    const collection = db.collection(collectionName)
    
    // Create a bulk operation
    const operations = transactions.map((tx: any) => ({
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
// if (import.meta.url === `file://${process.argv[1]}`) {
//   const minEthValue = process.argv[2] ? parseInt(process.argv[2]) : DEFAULT_MIN_ETH
//   const fromTimestamp = process.argv[3] ? parseInt(process.argv[3]) : null
//   const toTimestamp = process.argv[4] ? parseInt(process.argv[4]) : null
//   
//   let client: any // Store the MongoDB client for closing
//   
//   getDb()
//     .then(db => {
//       // Store reference to client for later closing
//       client = db.client
//       return updateTransactionsByAddressesOfInterest({ minEthValue, fromTimestamp, toTimestamp, existingDb: db })
//     })
//     .then(({ newTransactionsCount, allTransactionsCount }) => {
//       console.log(`Done! Added ${newTransactionsCount} new transactions. Total: ${allTransactionsCount}`)
//     })
//     .catch(err => {
//       console.error('Failed to update transactions:', err)
//       process.exit(1)
//     })
//     .finally(() => {
//       // Close the MongoDB connection to allow the process to exit
//       if (client) {
//         console.log('Closing MongoDB connection...')
//         client.close()
//           .then(() => console.log('MongoDB connection closed'))
//           .catch((err: any) => console.error('Error closing MongoDB connection:', err))
//       }
//     })
// }

export { updateTransactionsByAddressesOfInterest }
