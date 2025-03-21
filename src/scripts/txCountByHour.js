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
      // Add fields for date parts
      { $addFields: {
        // Create a truncated date at the hour level (remove minutes and seconds)
        hourDate: {
          $dateTrunc: {
            date: "$block_datetime",
            unit: "hour"
          }
        }
      }},
      // Group by the hour-level date
      { $group: {
        _id: { hourDate: "$hourDate" },
        count: { $sum: 1 }
      }},
      // Sort chronologically
      { $sort: { "_id.hourDate": 1 }}
    ]
    
    const results = await db.collection('transactions').aggregate(pipeline).toArray()
    
    if (results.length === 0) {
      console.log('No transactions found.')
      return
    }
    
    // Format the results for display
    const output = results.map(r => {
      const date = new Date(r._id.hourDate)
      // Format DD/MM/YY
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear().toString().substring(2)
      // Format HH
      const hour = date.getHours().toString().padStart(2, '0')
      
      return `${day}/${month}/${year} - ${hour},${r.count}`
    })
    
    console.log('Analysis complete.')
    console.log('\nHourly transaction counts (last 24 hrs):')
    
    // Get the last 24 entries chronologically
    const last24HrsOutput = output.slice(-24).join('\n')
    
    console.log(last24HrsOutput || 'No transactions in the last 24 hours')
    
    // Also store in MongoDB
    const analysisResults = results.map(r => {
      const date = new Date(r._id.hourDate)
      // Format DD/MM/YY
      const day = date.getDate().toString().padStart(2, '0')
      const month = (date.getMonth() + 1).toString().padStart(2, '0')
      const year = date.getFullYear().toString().substring(2)
      // Format HH
      const hour = date.getHours().toString().padStart(2, '0')
      const formattedDate = `${day}/${month}/${year}`
      
      return {
        date: formattedDate,
        hour: hour,
        count: r.count,
        date_hour: `${formattedDate} - ${hour}`,
        created_at: new Date(),
        // Store the date for proper sorting later
        hour_date: new Date(r._id.hourDate)
      }
    })
    
    // Get existing date_hour pairs to avoid duplicates
    const existingEntries = await db.collection('analysis_results')
      .find({}, { projection: { date_hour: 1, count: 1 } })
      .toArray()
    
    // Create a map of existing entries for easier lookup
    const existingEntriesMap = new Map()
    existingEntries.forEach(entry => {
      existingEntriesMap.set(entry.date_hour, { id: entry._id, count: entry.count })
    })
    
    // Separate results into new entries and updates
    const newResults = []
    const updatesToMake = []
    
    analysisResults.forEach(result => {
      const existingEntry = existingEntriesMap.get(result.date_hour)
      
      if (!existingEntry) {
        // This is a completely new entry
        newResults.push(result)
      } else if (existingEntry.count !== result.count) {
        // This entry exists but the count has changed - needs update
        updatesToMake.push({
          updateOne: {
            filter: { date_hour: result.date_hour },
            update: { $set: { count: result.count, updated_at: new Date() } }
          }
        })
      }
    })
    
    // Add debug logging
    console.log(`Found ${existingEntries.length} existing entries in MongoDB`)
    console.log(`Found ${analysisResults.length} total results from current analysis`)
    console.log(`After filtering: ${newResults.length} new entries, ${updatesToMake.length} updates needed`)
    
    // Process new entries
    if (newResults.length > 0) {
      await db.collection('analysis_results').insertMany(newResults)
      console.log(`Saved ${newResults.length} new analysis results to MongoDB`)
    }
    
    // Process updates
    if (updatesToMake.length > 0) {
      const updateResult = await db.collection('analysis_results').bulkWrite(updatesToMake)
      console.log(`Updated ${updateResult.modifiedCount} existing entries in MongoDB`)
    }
    
    if (newResults.length === 0 && updatesToMake.length === 0) {
      console.log('No changes needed to analysis results')
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
