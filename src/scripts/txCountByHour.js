import { getDb } from '../lib/mongodb.js'
import dotenv from 'dotenv'

// Load env vars because apparently we need to do this in every file
dotenv.config()

/**
 * Outputs hourly transaction counts for addresses of interest
 */
async function countTransactionsByHour(existingDb = null, existingClient = null) {
  console.log('Starting transaction analysis from MongoDB...')
  
  // Use existing connection or create new one
  const db = existingDb || await getDb()
  let client = existingClient || db.client // For closing connection later
  const shouldCloseConnection = !existingDb // Only close if we created a new connection
  
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
      // Add fields for date parts - using formats that work with MongoDB
      { $addFields: {
        fullDate: { $dateToString: { format: '%d/%m/%Y', date: '$block_datetime' } },
        hour: { $dateToString: { format: '%H', date: '$block_datetime' } }
      }},
      // Group by date and hour
      { $group: {
        _id: { fullDate: '$fullDate', hour: '$hour' },
        count: { $sum: 1 },
        transactions: { $push: '$$ROOT' }
      }},
      // Sort by date and hour
      { $sort: { '_id.fullDate': 1, '_id.hour': 1 } }
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
    
    console.log('Analysis complete.')
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
    
    // Get existing date_hour pairs to avoid duplicates
    const existingEntries = await db.collection('analysis_results')
      .find({}, { projection: { date_hour: 1 } })
      .toArray()
    
    const existingDateHours = new Set(existingEntries.map(entry => entry.date_hour))
    
    // Filter out results that already exist in the database
    const newResults = analysisResults.filter(result => !existingDateHours.has(result.date_hour))
    
    if (newResults.length > 0) {
      await db.collection('analysis_results').insertMany(newResults)
      console.log(`Saved ${newResults.length} new analysis results to MongoDB`)
    } else {
      console.log('No new analysis results to save')
    }
    
    return analysisResults
  } catch (error) {
    console.error('Analysis failed:', error)
    throw error
  } finally {
    // Close MongoDB connection so the process can exit, but only if we created it
    if (shouldCloseConnection && client) {
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

// Add a new function to clean up existing duplicates
async function removeDuplicateResults(closeConnection = true) {
  console.log('Removing duplicate entries from analysis_results collection...')
  
  const db = await getDb()
  let client = db.client
  
  try {
    // Find all date_hour combinations and their counts
    const duplicateCheck = await db.collection('analysis_results').aggregate([
      { $group: {
        _id: "$date_hour",
        count: { $sum: 1 },
        newestId: { $max: "$_id" }
      }},
      { $match: { count: { $gt: 1 } }}
    ]).toArray()
    
    console.log(`Found ${duplicateCheck.length} date_hour combinations with duplicates`)
    
    // For each duplicate group, keep the newest entry and delete the rest
    let deletedCount = 0
    for (const dupe of duplicateCheck) {
      const result = await db.collection('analysis_results').deleteMany({
        date_hour: dupe._id,
        _id: { $ne: dupe.newestId }
      })
      deletedCount += result.deletedCount
    }
    
    console.log(`Removed ${deletedCount} duplicate entries`)
    return { db, client, deletedCount }
  } catch (error) {
    console.error('Failed to remove duplicates:', error)
    if (closeConnection && client) {
      await client.close()
    }
    throw error
  } finally {
    if (closeConnection && client) {
      await client.close()
      console.log('MongoDB connection closed after duplicate removal')
    }
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // First clean up duplicates, then run the analysis
  removeDuplicateResults(false)  // Don't close connection yet
    .then(({ db, client }) => countTransactionsByHour(db, client))
    .then(() => {
      console.log('Analysis completed successfully')
      process.exit(0)
    })
    .catch(err => {
      console.error('Analysis failed:', err)
      process.exit(1)
    })
}

export { countTransactionsByHour, removeDuplicateResults }
