import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import axios from 'axios'
import { fetchTransactions } from './getTransactions.js'

/* 
    For step 5: Get all transactions for addresses of interest
    
    Usage:
    node src/getTransactionsByAddress.js addresses.json 1712000000 100
    
    Arguments:
    1. Path to JSON file containing addresses of interest
    2. Start timestamp (Unix timestamp) - optional, defaults to 30 days ago
    3. Minimum ETH value for transactions - optional, defaults to 100 ETH
*/

// Initialize dotenv
dotenv.config()

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const OUTPUT_DIR = path.join(__dirname, '../data')
const DEFAULT_MIN_ETH = 100 // Default minimum ETH value for transactions
const THIRTY_DAYS_IN_SECONDS = 30 * 24 * 60 * 60

// Read addresses from the specified file
async function readAddresses(filePath) {
  try {
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(OUTPUT_DIR, filePath)
    
    console.log(`Reading addresses from: ${fullPath}`)
    const data = fs.readFileSync(fullPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    console.error(`Error reading addresses file ${filePath}:`, error)
    throw error
  }
}

// Get all transactions for a list of addresses
async function getTransactionsByAddresses(addressesFilePath, startTimestamp, minEthValue = DEFAULT_MIN_ETH) {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    }
    
    // Read addresses of interest
    const addresses = await readAddresses(addressesFilePath)
    console.log(`Found ${addresses.length} addresses of interest`)
    
    // Current timestamp for end time
    const endTimestamp = Math.floor(Date.now() / 1000)
    
    const allTransactions = []
    const addressesProcessed = new Set()
    const relatedAddresses = new Set()
    
    // Process each address
    for (let i = 0; i < addresses.length; i++) {
      const address = addresses[i]
      
      if (addressesProcessed.has(address.toLowerCase())) {
        console.log(`Skipping duplicate address: ${address}`)
        continue
      }
      
      addressesProcessed.add(address.toLowerCase())
      console.log(`Processing address ${i+1}/${addresses.length}: ${address}`)
      
      // Get transactions where this address is the sender
      console.log(`Fetching transactions sent FROM ${address}`)
      const sentTransactions = await fetchTransactions(startTimestamp, endTimestamp, {
        fromAddress: address,
        minEthValue
      })
      
      // Get transactions where this address is the receiver
      console.log(`Fetching transactions sent TO ${address}`)
      const receivedTransactions = await fetchTransactions(startTimestamp, endTimestamp, {
        toAddress: address,
        minEthValue
      })
      
      // Process and add metadata to transactions
      const processedSentTxs = sentTransactions ? sentTransactions.map(tx => {
        // Add related address to our set
        if (tx.to_address) relatedAddresses.add(tx.to_address.toLowerCase())
        
        return {
          hash: tx.hash,
          from_address: tx.from_address,
          to_address: tx.to_address,
          txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
          value: tx.value,
          valueInEth: Number(tx.value) / (10 ** 18),
          addressOfInterest: address,
          direction: 'sent'
        }
      }) : []
      
      const processedReceivedTxs = receivedTransactions ? receivedTransactions.map(tx => {
        // Add related address to our set
        if (tx.from_address) relatedAddresses.add(tx.from_address.toLowerCase())
        
        return {
          hash: tx.hash,
          from_address: tx.from_address,
          to_address: tx.to_address,
          txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
          value: tx.value,
          valueInEth: Number(tx.value) / (10 ** 18),
          addressOfInterest: address,
          direction: 'received'
        }
      }) : []
      
      allTransactions.push(...processedSentTxs, ...processedReceivedTxs)
      
      // Be nice to the API - add a small delay between addresses
      if (i < addresses.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    // Remove addresses of interest from related addresses
    addresses.forEach(addr => relatedAddresses.delete(addr.toLowerCase()))
    
    // Create a filename based on parameters
    const filenameSuffix = path.basename(addressesFilePath, '.json')
    const outputPath = path.join(OUTPUT_DIR, `transactions_by_address_${filenameSuffix}.json`)
    const relatedAddressesPath = path.join(OUTPUT_DIR, `related_addresses_${filenameSuffix}.json`)
    
    // Sort transactions by timestamp
    allTransactions.sort((a, b) => a.block_timestamp - b.block_timestamp)
    
    // Save all transactions to file
    fs.writeFileSync(outputPath, JSON.stringify(allTransactions, null, 2))
    
    // Save related addresses to file
    fs.writeFileSync(relatedAddressesPath, JSON.stringify(Array.from(relatedAddresses), null, 2))
    
    console.log(`Saved ${allTransactions.length} transactions to ${outputPath}`)
    console.log(`Saved ${relatedAddresses.size} related addresses to ${relatedAddressesPath}`)
    
    return {
      transactions: allTransactions,
      relatedAddresses: Array.from(relatedAddresses)
    }
  } catch (error) {
    console.error('Error processing transactions by address:', error)
    throw error
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const addressesFilePath = process.argv[2]
  
  if (!addressesFilePath) {
    console.error('Please provide path to the addresses JSON file')
    console.error('Example: node src/getTransactionsByAddress.js addresses.json [startTimestamp] [minEthValue]')
    process.exit(1)
  }
  
  // Default to 30 days ago if no timestamp provided
  const defaultStartTime = Math.floor(Date.now() / 1000) - THIRTY_DAYS_IN_SECONDS
  const startTimestamp = process.argv[3] ? parseInt(process.argv[3]) : defaultStartTime
  const minEthValue = process.argv[4] ? parseInt(process.argv[4]) : DEFAULT_MIN_ETH
  
  getTransactionsByAddresses(addressesFilePath, startTimestamp, minEthValue)
    .then(() => console.log('Done!'))
    .catch(err => {
      console.error('Failed to get transactions by address:', err)
      process.exit(1)
    })
}

export { getTransactionsByAddresses }
