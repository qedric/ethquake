import { getDb, connectToDatabase } from '../lib/mongodb.js'
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
            date: '$block_datetime',
            unit: 'hour'
          }
        }
      }},
      // Group by the hour-level date
      { $group: {
        _id: { hourDate: '$hourDate' },
        count: { $sum: 1 }
      }},
      // Sort chronologically
      { $sort: { '_id.hourDate': 1 }}
    ]
    
    const results = await db.collection('transactions').aggregate(pipeline).toArray()
    
    if (results.length === 0) {
      console.log('No transactions found.')
      return
    }
    
    // Format the results for display (only for console output)
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
    
    // Prepare data for storing in MongoDB with proper date handling
    const analysisResults = results.map(r => {
      const timestamp = new Date(r._id.hourDate)
      const hour = timestamp.getUTCHours()
      
      return {
        timestamp: timestamp,           // Proper Date object for the start of the hour
        hour: hour,                     // Hour as a number (0-23) IN UTC
        count: r.count,
        created_at: new Date(),
        // For backward compatibility
        display_date_hour: formatDateHour(timestamp)
      }
    })
    
    // Get existing timestamps to avoid duplicates
    const existingEntries = await db.collection('transactions_per_hour')
      .find({}, { projection: { timestamp: 1, count: 1 } })
      .toArray()
    
    // Create a map of existing entries for easier lookup
    const existingEntriesMap = new Map()
    existingEntries.forEach(entry => {
      // Use timestamp as the key
      const key = entry.timestamp.getTime()
      existingEntriesMap.set(key, { id: entry._id, count: entry.count })
    })
    
    // Separate results into new entries and updates
    const newResults = []
    const updatesToMake = []
    
    analysisResults.forEach(result => {
      const key = result.timestamp.getTime()
      const existingEntry = existingEntriesMap.get(key)
      
      if (!existingEntry) {
        // This is a completely new entry
        newResults.push(result)
      } else if (existingEntry.count !== result.count) {
        // This entry exists but the count has changed - needs update
        updatesToMake.push({
          updateOne: {
            filter: { _id: existingEntry.id },
            update: { 
              $set: { 
                count: result.count, 
                updated_at: new Date() 
              } 
            }
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
      await db.collection('transactions_per_hour').insertMany(newResults)
      console.log(`Saved ${newResults.length} new analysis results to MongoDB`)
    }
    
    // Process updates
    if (updatesToMake.length > 0) {
      const updateResult = await db.collection('transactions_per_hour').bulkWrite(updatesToMake)
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

// Format date and hour for display (DD/MM/YY - HH)
function formatDateHour(date) {
  const day = date.getUTCDate().toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = date.getUTCFullYear().toString().substring(2)
  const hour = date.getUTCHours().toString().padStart(2, '0')
  return `${day}/${month}/${year} - ${hour}`
}

// Get list of addresses of interest from MongoDB
async function getAddressesOfInterest(db) {
  const addresses = await db.collection('addresses_of_interest')
    .find({})
    .project({ address: 1, _id: 0 })
    .toArray()
  
  return addresses.map(a => a.address)
}

// Migrate data from old collection to new one
async function migrateToNewCollection() {
  console.log('Migrating data from analysis_results to transactions_per_hour...')
  
  try {
    await connectToDatabase()
    const db = await getDb()
    
    // Get all entries from old collection
    const oldEntries = await db.collection('analysis_results').find({}).toArray()
    console.log(`Found ${oldEntries.length} entries to migrate`)
    
    if (oldEntries.length === 0) {
      console.log('No entries to migrate')
      return { migrated: 0 }
    }
    
    // Convert to new format
    const newEntries = oldEntries.map(entry => {
      // Parse DD/MM/YY format
      const [day, month, year] = entry.date.split('/')
      const hour = parseInt(entry.hour)
      
      // Create proper date object (assuming 20xx for the year)
      // Use UTC methods to ensure timezone consistency
      const timestamp = new Date(Date.UTC(2000 + parseInt(year), parseInt(month) - 1, parseInt(day), hour))
      
      return {
        timestamp: timestamp,
        hour: hour,  // This should be correct since we're explicitly setting it in UTC above
        count: entry.count,
        display_date_hour: entry.date_hour || formatDateHour(timestamp),
        created_at: entry.created_at || new Date(),
        updated_at: entry.updated_at || new Date()
      }
    })
    
    // Delete all existing data in new collection
    await db.collection('transactions_per_hour').deleteMany({})
    
    // Insert all migrated data
    await db.collection('transactions_per_hour').insertMany(newEntries)
    
    console.log(`Successfully migrated ${newEntries.length} entries`)
    return { migrated: newEntries.length }
  } catch (error) {
    console.error('Migration failed:', error)
    throw error
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  // Check if we should migrate
  const shouldMigrate = process.argv.includes('--migrate')
  
  // Create a promise chain
  let chain = Promise.resolve()
  
  // Add migration if needed
  if (shouldMigrate) {
    chain = chain.then(() => migrateToNewCollection())
  }
  
  // Run the analysis
  chain
    .then(() => countTransactionsByHour())
    .then(() => {
      console.log('Analysis completed successfully')
      process.exit(0)
    })
    .catch(err => {
      console.error('Analysis failed:', err)
      process.exit(1)
    })
}

export { countTransactionsByHour, migrateToNewCollection }
