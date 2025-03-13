import axios from 'axios'
import dotenv from 'dotenv'
import { client } from './mongodb.js'
const dbName = "cryptoData"
const collectionName = "ethPrices"
const intervalInSeconds = 300

dotenv.config()

/**
 * Fetches the latest timestamp from the MongoDB collection
 * @returns {Promise<number>} The latest timestamp or null if no records exist
 */
const getLatestTimestampFromMongoDB = async () => {
  try {
    const db = client.db(dbName)
    const collection = db.collection(collectionName)
    
    const totalRecords = await collection.countDocuments()
    const firstRecord = await collection.find().sort({ timestamp: 1 }).limit(1).toArray()
    const latestRecord = await collection.find().sort({ timestamp: -1 }).limit(1).toArray()
    
    console.log(`Total records: ${totalRecords}`)
    console.log(`First record date: ${firstRecord.length > 0 ? new Date(firstRecord[0].timestamp).toLocaleDateString('en-GB') : 'N/A'}`)
    console.log(`Latest record date: ${latestRecord.length > 0 ? new Date(latestRecord[0].timestamp).toLocaleDateString('en-GB') : 'N/A'}`)
    
    const userResponse = await new Promise(resolve => {
      process.stdout.write('Do you want to continue? y/n: ')
      process.stdin.once('data', data => resolve(data.toString().trim()))
    })
    
    if (userResponse.toLowerCase() !== 'y') {
      console.log('Operation cancelled by user.')
      process.exit(0)
    }
    
    return latestRecord.length > 0 ? latestRecord[0].timestamp : null
  } catch (err) {
    console.error("Error fetching latest timestamp from MongoDB:", err)
    return null
  }
}

/**
 * Fetches ETH/USD price data with 5-minute granularity
 * @returns {Promise<Array>} Array of price data objects
 */
const fetchHistoricalETHPrices = async () => {
  const batches = []
  const now = Math.floor(Date.now() / 1000)
  
  // Get the latest timestamp from MongoDB
  const latestTimestamp = await getLatestTimestampFromMongoDB()
  
  // If no records, default to 90 days ago
  const startTimestamp = latestTimestamp ? Math.floor(latestTimestamp / 1000) : now - (90 * 24 * 60 * 60)
  
  // Create batches from the latest timestamp or 90 days ago
  for (let start = startTimestamp; start < now; start += intervalInSeconds) {
    const endDate = Math.min(start + intervalInSeconds, now)
    batches.push({ startDate: start, endDate })
  }
  
  // Sort batches to start from the oldest
  batches.sort((a, b) => a.startDate - b.startDate)

  for (const [index, batch] of batches.entries()) {
    let consecutive429Errors = 0 // Track consecutive 429 errors
    try {
      console.log(`Fetching batch ${index + 1}/${batches.length}: ${new Date(batch.startDate * 1000).toLocaleDateString()}`)
      
      if (index > 0) {
        const delay = index % 10 === 0 ? 10000 : 1500
        console.log(`Waiting ${delay/1000} seconds to avoid rate limiting...`)
        await new Promise(resolve => setTimeout(resolve, delay))
      }
      
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/coins/ethereum/market_chart/range`, {
          params: {
            vs_currency: 'usd',
            from: batch.startDate,
            to: batch.endDate
          },
          headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json'
          }
        }
      )

      console.log('response:', response)
      
      const batchPrices = response.data.prices.map(([timestamp, price]) => ({
        date: new Date(timestamp),
        timestamp,
        price,
        dateString: new Date(timestamp).toISOString()
      }))
      
      console.log(`Batch ${index + 1} fetched: ${batchPrices.length} price points`)
      
      // Store each day's data in MongoDB immediately
      await storePricesInMongoDB(batchPrices)
      
      consecutive429Errors = 0 // Reset on successful fetch
      
    } catch (error) {
      if (error.response && error.response.status === 429) {
        consecutive429Errors++
        const waitTime = consecutive429Errors === 1 ? 2000 : 31000
        console.error(`429 error encountered, waiting ${waitTime / 1000} seconds before retrying...`)
        await new Promise(resolve => setTimeout(resolve, waitTime))
      } else {
        console.error(`Error fetching batch ${index + 1}:`, error.message)
        console.log('Error encountered, waiting 31 seconds before continuing...')
        await new Promise(resolve => setTimeout(resolve, 31000))
      }
    }
  }
  
  console.log(`Total price points: ${batches.length}`)
  
  // Sort by timestamp to ensure chronological order
  batches.sort((a, b) => a.startDate - b.startDate)
  
  return batches
}

/**
 * Stores price data in MongoDB
 * @param {Array} priceData - The price data to store
 */
const storePricesInMongoDB = async (priceData) => {
  try {
    // No need to create a new client or connect explicitly
    console.log(`loading ${priceData} into mongodb...`)
    
    const db = client.db(dbName)
    const collection = db.collection(collectionName)
    
    // Insert all price data
    for (const price of priceData) {
      const result = await collection.updateOne(
        { timestamp: price.timestamp }, // Match existing timestamp
        { $set: price }, // Update with new data
        { upsert: true } // Insert if not exists
      );
    }
    //console.log(`${result.insertedCount} documents inserted into MongoDB`)
    
    // Create index on date field for faster queries
    await collection.createIndex({ date: 1 })
    console.log("Index created on date field")
  } catch (err) {
    console.error("MongoDB error:", err)
  }
  // No need to close the connection as we're using a shared client
}

// Fetch and store the data
const main = async () => {
  try {
    console.log("Starting ETH price data collection...")
    const priceData = await fetchHistoricalETHPrices()
    if (priceData.length > 0) {
      await storePricesInMongoDB(priceData)
    }
  } catch (error) {
    console.error("Error in main function:", error)
  }
}

main()
