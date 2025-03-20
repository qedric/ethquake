import { getDbClient } from '../lib/mongodb.js'
import dotenv from 'dotenv'
import path from 'path'
import fs from 'fs'
import { fileURLToPath } from 'url'

// Load env vars because apparently we need to do this in every file
dotenv.config()

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

/**
 * Analyzes transaction data from MongoDB to identify patterns in address activity
 * Outputs hourly transaction counts for addresses of interest
 */
async function analyzeTransactions() {
  console.log('Starting transaction analysis from MongoDB...')
  
  // Get MongoDB connection - hopefully it works this time
  const db = await getDbClient()
  let client = db.client // For closing connection later
  
  try {
    // Count of transactions by hour
    console.log('Aggregating transactions by hour...')
    
    const pipeline = [
      // Match transactions that involve addresses of interest
      { $match: {
        $or: [
          { from_address: { $in: await getAddressesOfInterest(db) } },
          { to_address: { $in: await getAddressesOfInterest(db) } }
        ]
      }},
      // Add fields for date parts - using formats that actually work with MongoDB
      { $addFields: {
        fullDate: { $dateToString: { format: "%d/%m/%Y", date: "$block_datetime" } },
        hour: { $dateToString: { format: "%H", date: "$block_datetime" } }
      }},
      // Group by date and hour
      { $group: {
        _id: { fullDate: "$fullDate", hour: "$hour" },
        count: { $sum: 1 },
        transactions: { $push: "$$ROOT" }
      }},
      // Sort by date and hour
      { $sort: { "_id.fullDate": 1, "_id.hour": 1 } }
    ]
    
    const results = await db.collection('transactions').aggregate(pipeline).toArray()
    
    if (results.length === 0) {
      console.log('No transactions found. Did you even load any data?')
      return
    }
    
    // Format the results - convert 4-digit year to 2-digit year here in JavaScript
    const output = results.map(r => {
      // Format from DD/MM/YYYY to DD/MM/YY
      const dateParts = r._id.fullDate.split('/')
      const year = dateParts[2].substring(2) // Get last 2 digits
      const formattedDate = `${dateParts[0]}/${dateParts[1]}/${year}`
      
      return `${formattedDate} - ${r._id.hour},${r.count}`
    }).join('\n')
    
    // Save to file because apparently CSV is still a thing
    const outputDir = path.join(__dirname, '..', '..', 'data', 'analysis')
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true })
    }
    
    const outputFile = path.join(outputDir, `hourly_analysis_${new Date().toISOString().slice(0,10)}.csv`)
    fs.writeFileSync(outputFile, output)
    
    console.log(`Analysis complete. Results saved to ${outputFile}`)
    console.log('\nHourly transaction counts:')
    console.log(output)
    
    // Also store in MongoDB
    const analysisResults = results.map(r => {
      // Format from DD/MM/YYYY to DD/MM/YY
      const dateParts = r._id.fullDate.split('/')
      const year = dateParts[2].substring(2) // Get last 2 digits
      const formattedDate = `${dateParts[0]}/${dateParts[1]}/${year}`
      
      return {
        date: formattedDate,
        hour: r._id.hour,
        count: r.count,
        date_hour: `${formattedDate} - ${r._id.hour}`,
        created_at: new Date()
      }
    })
    
    await db.collection('analysis_results').insertMany(analysisResults)
    console.log(`Saved ${analysisResults.length} analysis results to MongoDB`)
    
    return analysisResults
  } catch (error) {
    console.error('Analysis failed:', error)
    throw error
  } finally {
    // Close MongoDB connection so the process can exit
    if (client) {
      console.log('Closing MongoDB connection...')
      await client.close()
      console.log('MongoDB connection closed')
    }
  }
}

// Get list of addresses of interest from MongoDB
async function getAddressesOfInterest(db) {
  const addresses = await db.collection('addresses_of_interest')
    .find({})
    .project({ address: 1, _id: 0 })
    .toArray()
  
  return addresses.map(a => a.address)
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  analyzeTransactions()
    .then(() => {
      console.log('Analysis completed successfully')
      process.exit(0)
    })
    .catch(err => {
      console.error('Analysis failed:', err)
      process.exit(1)
    })
}

export { analyzeTransactions }
