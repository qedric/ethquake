import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import { fetchTransactions } from './getTransactions.js'

/**
 * Updates transactions for addresses of interest by fetching new ones since the latest block in the existing data.
 * 
 * Usage via CLI:
 *   node src/updateTransactionsByAddress.js [transactionsFilePath] [minEthValue]
 * 
 * Examples:
 *   node src/updateTransactionsByAddress.js
 *     - Uses default path: data/transactions_by_addresses_of_interest_6pct.json
 *     - Uses default minimum ETH value: 100
 *   
 *   node src/updateTransactionsByAddress.js custom_transactions.json 200
 *     - Updates transactions in data/custom_transactions.json
 *     - Only includes transactions of 200+ ETH
 * 
 * Usage via import:
 *   import { updateTransactionsByAddressesOfInterest } from './updateTransactionsByAddress.js'
 *   
 *   // Update transactions with default parameters
 *   await updateTransactionsByAddressesOfInterest()
 *   
 *   // Update transactions with custom parameters
 *   await updateTransactionsByAddressesOfInterest('path/to/transactions.json', 150)
 */

// Having to load environment variables for the millionth time
dotenv.config()

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const DEFAULT_MIN_ETH = 100
const WEI_TO_ETH = 1e18

/**
 * Updates transactions for addresses of interest by fetching new ones since the latest block in the existing data
 * 
 * @param {string} transactionsFilePath - Path to file containing existing transactions (relative to data/ directory or absolute)
 * @param {number} minEthValue - Minimum transaction value in ETH to include
 * @returns {Object} Object containing counts of all transactions and new transactions added
 */
async function updateTransactionsByAddressesOfInterest(transactionsFilePath, minEthValue = DEFAULT_MIN_ETH) {
  // Load existing transaction data because apparently we can't just start fresh
  console.log(`Reading existing transaction data from ${transactionsFilePath}...`)
  let existingTransactions = []
  
  try {
    const data = fs.readFileSync(transactionsFilePath, 'utf8')
    existingTransactions = JSON.parse(data)
    console.log(`Found ${existingTransactions.length} existing transactions.`)
  } catch (error) {
    if (error.code === 'ENOENT') {
      console.log('No existing transaction file found. Will create a new one.')
    } else {
      throw new Error(`Failed to read existing transactions: ${error.message}`)
    }
  }

  // Find the highest block_number from existing transactions
  let latestBlockNumber = 0
  if (existingTransactions.length > 0) {
    latestBlockNumber = Math.max(...existingTransactions.map(tx => parseInt(tx.block_number)))
    console.log(`Latest block number in existing data: ${latestBlockNumber}`)
  } else {
    // If there are no transactions yet, we need to abort
    console.log('No existing transactions found. This script is for updates only.')
    console.log('Please use getTransactionsByAddress.js first to create the initial dataset.')
    throw new Error('No existing transactions to update')
  }

  // Load addresses of interest
  const addressesFilePath = path.resolve(__dirname, '../data/addresses_of_interest_6pct.json')
  let addressesOfInterest = []
  
  try {
    const addressesData = fs.readFileSync(addressesFilePath, 'utf8')
    addressesOfInterest = JSON.parse(addressesData)
    console.log(`Loaded ${addressesOfInterest.length} addresses of interest.`)
  } catch (error) {
    throw new Error(`Failed to load addresses of interest: ${error.message}`)
  }

  if (addressesOfInterest.length === 0) {
    throw new Error('No addresses of interest found. Nothing to update.')
  }

  // Fetch new transactions for all addresses 
  console.log(`Fetching new transactions since block ${latestBlockNumber} for ${addressesOfInterest.length} addresses...`)
  
  const minWeiValue = BigInt(minEthValue) * BigInt(WEI_TO_ETH)
  let newTransactions = []
  let processedAddresses = 0
  
  // Process addresses in chunks because apparently doing them all at once would blow up the API
  const chunkSize = 20
  
  for (let i = 0; i < addressesOfInterest.length; i += chunkSize) {
    const addressesChunk = addressesOfInterest.slice(i, i + chunkSize)
    const chunkPromises = []
    
    for (const address of addressesChunk) {
      if (!address) continue // Skip empty addresses because apparently that's a thing

      // Need to check for both sending and receiving transactions
      const fromPromise = fetchTransactions({
        filter_from_address: address,
        filter_block_number_gt: latestBlockNumber,
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
        filter_block_number_gt: latestBlockNumber,
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
    
    try {
      const chunkResults = await Promise.all(chunkPromises)
      for (const transactions of chunkResults) {
        if (transactions && transactions.length > 0) {
          newTransactions = [...newTransactions, ...transactions]
        }
      }
      
      processedAddresses += addressesChunk.length
      console.log(`Processed ${processedAddresses}/${addressesOfInterest.length} addresses...`)
    } catch (error) {
      console.error(`Error fetching transactions for addresses chunk: ${error.message}`)
    }
    
    // Rate limiting because ThirdWeb's API probably can't handle our volume
    await new Promise(resolve => setTimeout(resolve, 1000))
  }
  
  // Deduplicate because we're going to get the same transaction multiple times
  console.log(`Found ${newTransactions.length} new transactions before deduplication.`)
  
  const transactionMap = new Map()
  
  // Add existing transactions to the map
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
  
  // Convert the map values back to an array and sort by block_number
  const allTransactions = Array.from(transactionMap.values())
    .sort((a, b) => parseInt(a.block_number) - parseInt(b.block_number))
  
  // Save the updated transactions
  fs.writeFileSync(transactionsFilePath, JSON.stringify(allTransactions, null, 2))
  console.log(`Updated transaction data saved to ${transactionsFilePath}`)
  
  return {
    allTransactionsCount: allTransactions.length,
    newTransactionsCount: newUniqueCount
  }
}

// Run the script if called directly because who doesn't love CLI scripts
if (import.meta.url === `file://${process.argv[1]}`) {
  // Default file path if not provided
  const defaultFilePath = path.resolve(__dirname, '../data/monitor/transactions_by_addresses_of_interest_6pct.json')
  
  const transactionsFilePath = process.argv[2] || defaultFilePath
  const minEthValue = process.argv[3] ? parseInt(process.argv[3]) : DEFAULT_MIN_ETH
  
  updateTransactionsByAddressesOfInterest(transactionsFilePath, minEthValue)
    .then(({ newTransactionsCount, allTransactionsCount }) => {
      console.log(`Done! Added ${newTransactionsCount} new transactions. Total: ${allTransactionsCount}`)
    })
    .catch(err => {
      console.error('Failed to update transactions:', err)
      process.exit(1)
    })
}

export { updateTransactionsByAddressesOfInterest }
