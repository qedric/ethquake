import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import dotenv from 'dotenv'
import axios from 'axios'

// Initialize dotenv FIRST before any env vars are accessed
dotenv.config()

// Extra debug logging for Railway issues
console.log('ENVIRONMENT DEBUG:')
console.log('All env vars:', Object.keys(process.env).join(', '))
console.log('Env vars starting with TW:', Object.keys(process.env).filter(key => key.startsWith('TW')))
console.log('Env vars starting with tw:', Object.keys(process.env).filter(key => key.startsWith('tw')))
console.log('Full env dump (partial):', JSON.stringify(process.env).substring(0, 500))

/* 

    For step 2 (transactions before price movements):
    node src/getTransactions.js target percentage_price_movements_timestamps/6.json

    For step 3 (control group transactions):
    node src/getTransactions.js control percentage_price_movements_timestamps/6.json

    You can also specify a custom lookback period (in hours) as an optional fourth argument:
    node src/getTransactions.js target percentage_price_movements_timestamps/6.json 2

*/

// Get directory name in ESM
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Constants
const TW_CLIENT_ID = process.env.TW_CLIENT_ID || process.env.tw_client_id || process.env.TWCLIENTID || process.env.twClientId
const OUTPUT_DIR = path.join(__dirname, '../data')
const DEFAULT_MIN_ETH_VALUE = '100000000000000000000'

// Add more debugging to help troubleshoot Railway issues
console.log('TW_CLIENT_ID resolution attempts:')
console.log('- process.env.TW_CLIENT_ID:', process.env.TW_CLIENT_ID ? 'Found' : 'Missing')
console.log('- process.env.tw_client_id:', process.env.tw_client_id ? 'Found' : 'Missing')
console.log('- process.env.TWCLIENTID:', process.env.TWCLIENTID ? 'Found' : 'Missing')
console.log('- process.env.twClientId:', process.env.twClientId ? 'Found' : 'Missing')
console.log('- Final TW_CLIENT_ID:', TW_CLIENT_ID ? 'Found' : 'Missing')

if (!TW_CLIENT_ID) {
  console.error('Missing TW_CLIENT_ID in environment variables. Check Railway configuration!')
  process.exit(1)
}

// Read timestamps from the specified file
async function readTimestamps(filePath) {
  try {
    const fullPath = path.isAbsolute(filePath) 
      ? filePath 
      : path.join(OUTPUT_DIR, filePath)
    
    console.log(`Reading timestamps from: ${fullPath}`)
    const data = fs.readFileSync(fullPath, 'utf8')
    return JSON.parse(data)
  } catch (error) {
    console.error(`Error reading timestamps file ${filePath}:`, error)
    throw error
  }
}

// Generate control timestamps evenly distributed between min and max timestamps
function generateControlTimestamps(priceMovements, count) {
  // Sort timestamps chronologically
  const sortedMovements = [...priceMovements].sort((a, b) => a.timestamp - b.timestamp)
  
  const minTimestamp = sortedMovements[0].timestamp
  const maxTimestamp = sortedMovements[sortedMovements.length - 1].timestamp
  const timeRange = maxTimestamp - minTimestamp
  
  // Generate evenly spaced timestamps
  const controlTimestamps = []
  for (let i = 0; i < count; i++) {
    const offset = Math.floor((timeRange * (i + 1)) / (count + 1))
    const timestamp = minTimestamp + offset
    const date = new Date(timestamp * 1000).toISOString().replace('T', ' ').substring(0, 19)
    controlTimestamps.push({ timestamp, date })
  }
  
  return controlTimestamps
}

/**
 * Fetches transactions from ThirdWeb Insights API with flexible filtering options
 * @param {Object} options - Filter options for the API query
 * @returns {Array} Array of transaction objects
 */
async function fetchTransactions(params = {}) {
  // Use the already checked TW_CLIENT_ID from above
  if (!TW_CLIENT_ID) {
    throw new Error('TW_CLIENT_ID was not found. This should have been caught earlier.')
  }

  const baseUrl = 'https://insight.thirdweb.com/v1/transactions'
  const defaultParams = {
    chain: '1',
    sort_by: 'block_number',
    sort_order: 'desc',
    limit: '200',
    clientId: TW_CLIENT_ID
  }

  // Add filter for minimum ETH value if not provided
  if (!params.filter_value_gte) {
    defaultParams.filter_value_gte = DEFAULT_MIN_ETH_VALUE
  }
  
  // Add all filters from options
  for (const [key, value] of Object.entries(params)) {
    // Skip null or undefined values
    if (value === null || value === undefined) continue
    
    // Add filter parameter to URL
    defaultParams[key] = value
  }
  
  // Log basic info about the request (keeping some logging for debugging)
  /* console.log(`Fetching transactions with filters:`, 
    Object.keys(options).length > 0 ? options : 'No filters') */
  
  const response = await axios.get(baseUrl, { params: defaultParams })
  return response.data.data || [] 
}

// Process transactions before price movements (Step 2)
async function getTransactionsBeforePriceMovements(timestampFilePath, lookbackHours = 1) {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    }
    
    // Read timestamps of price movements
    const priceMovements = await readTimestamps(timestampFilePath)
    console.log(`Found ${priceMovements.length} price movement timestamps`)
    
    const allTransactions = []
    
    // For each price movement, get transactions from the specified hours before
    for (let i = 0; i < priceMovements.length; i++) {
      const movement = priceMovements[i]
      const movementTimestamp = movement.timestamp
      const lookbackSeconds = lookbackHours * 3600
      const startTimestamp = movementTimestamp - lookbackSeconds
      
      console.log(`Processing price movement ${i+1}/${priceMovements.length} at ${movement.date}`)
      
      // Fetch transactions for the period before the price movement
      const transactions = await fetchTransactions({
        filter_block_timestamp_gte: startTimestamp,
        filter_block_timestamp_lte: movementTimestamp,
        sort_by: 'block_number',
        sort_order: 'desc',
        filter_value_gte: DEFAULT_MIN_ETH_VALUE
      })
      console.log(`Found ${transactions.length} transactions before this price movement`)
      
      // Add to our collection with metadata
      const processedTxs = transactions.map(tx => ({
        ...tx,
        valueString: tx.value.toString(),
        priceMovementTimestamp: movementTimestamp,
        priceMovementDateTime: movement.date,
        txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
        group: 'target' // Mark as part of target group
      }))
      
      allTransactions.push(...processedTxs)
      
      // Be nice to the API - add a small delay between requests
      if (i < priceMovements.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    // Extract percentage from filename for output naming
    const percentageMatch = timestampFilePath.match(/(\d+)\.json$/)
    const percentageStr = percentageMatch ? percentageMatch[1] : 'unknown'
    
    // Save all transactions to file
    const outputPath = path.join(OUTPUT_DIR, `transactions_before_${percentageStr}pct_movements.json`)
    fs.writeFileSync(outputPath, JSON.stringify(allTransactions, null, 2))
    
    console.log(`Saved ${allTransactions.length} transactions to ${outputPath}`)
    return allTransactions
  } catch (error) {
    console.error('Error processing transactions:', error)
    throw error
  }
}

// Process transactions for control group (Step 3)
async function getControlGroupTransactions(timestampFilePath, lookbackHours = 1) {
  try {
    // Ensure output directory exists
    if (!fs.existsSync(OUTPUT_DIR)) {
      fs.mkdirSync(OUTPUT_DIR, { recursive: true })
    }
    
    // Read timestamps of price movements
    const priceMovements = await readTimestamps(timestampFilePath)
    
    // Generate control timestamps (same number as price movements)
    const controlTimestamps = generateControlTimestamps(priceMovements, priceMovements.length)
    console.log(`Generated ${controlTimestamps.length} control timestamps`)
    
    const allTransactions = []
    
    // For each control timestamp, get transactions from the specified hours before
    for (let i = 0; i < controlTimestamps.length; i++) {
      const control = controlTimestamps[i]
      const controlTimestamp = control.timestamp
      const lookbackSeconds = lookbackHours * 3600
      const startTimestamp = controlTimestamp - lookbackSeconds
      
      console.log(`Processing control period ${i+1}/${controlTimestamps.length} at ${control.date}`)
      
      // Fetch transactions for the control period
      const transactions = await fetchTransactions({
        filter_block_timestamp_gte: startTimestamp,
        filter_block_timestamp_lte: controlTimestamp,
        sort_by: 'block_number',
        sort_order: 'desc',
        filter_value_gte: DEFAULT_MIN_ETH_VALUE
      })
      console.log(`Found ${transactions.length} transactions in this control period`)
      
      // Add to our collection with metadata
      const processedTxs = transactions.map(tx => ({
        ...tx,
        controlTimestamp: controlTimestamp,
        controlDateTime: control.date,
        txDateTime: new Date(tx.block_timestamp * 1000).toISOString(),
        group: 'control' // Mark as part of control group
      }))
      
      allTransactions.push(...processedTxs)
      
      // Be nice to the API - add a small delay between requests
      if (i < controlTimestamps.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    }
    
    // Extract percentage from filename for output naming
    const percentageMatch = timestampFilePath.match(/(\d+)\.json$/)
    const percentageStr = percentageMatch ? percentageMatch[1] : 'unknown'
    
    // Save control timestamps for reference
    const controlTimestampsPath = path.join(OUTPUT_DIR, `control_timestamps_${percentageStr}pct.json`)
    fs.writeFileSync(controlTimestampsPath, JSON.stringify(controlTimestamps, null, 2))
    
    // Save all transactions to file
    const outputPath = path.join(OUTPUT_DIR, `transactions_control_${percentageStr}pct.json`)
    fs.writeFileSync(outputPath, JSON.stringify(allTransactions, null, 2))
    
    console.log(`Saved ${allTransactions.length} control transactions to ${outputPath}`)
    return allTransactions
  } catch (error) {
    console.error('Error processing control transactions:', error)
    throw error
  }
}

// Execute if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const mode = process.argv[2]
  const timestampFilePath = process.argv[3]
  const lookbackHours = process.argv[4] ? parseInt(process.argv[4]) : 1
  
  if (!mode || !timestampFilePath) {
    console.error('Please provide mode (target/control) and path to the timestamp JSON file')
    console.error('Example: node src/getTransactions.js target percentage_price_movements_timestamps/6.json [lookbackHours]')
    console.error('Example: node src/getTransactions.js control percentage_price_movements_timestamps/6.json [lookbackHours]')
    process.exit(1)
  }
  
  if (mode === 'target') {
    getTransactionsBeforePriceMovements(timestampFilePath, lookbackHours)
      .then(() => console.log('Done!'))
      .catch(err => {
        console.error('Failed to get target transactions:', err)
        process.exit(1)
      })
  } else if (mode === 'control') {
    getControlGroupTransactions(timestampFilePath, lookbackHours)
      .then(() => console.log('Done!'))
      .catch(err => {
        console.error('Failed to get control transactions:', err)
        process.exit(1)
      })
  } else {
    console.error('Invalid mode. Use "target" or "control"')
    process.exit(1)
  }
}

export { 
  getTransactionsBeforePriceMovements, 
  getControlGroupTransactions, 
  fetchTransactions 
}
