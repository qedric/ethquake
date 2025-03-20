import { getDbClient } from '../../src/lib/mongodb.js'
import fs from 'fs'
import path from 'path'

/**
 * Migrates addresses of interest from JSON files to MongoDB
 * 
 * Usage:
 *   node src/scripts/migrateAddressesOfInterest.js [percentageFilter]
 * 
 * Examples:
 *   node src/scripts/migrateAddressesOfInterest.js
 *     - Migrates addresses from all percentage files (6%, 8%, 10%)
 *   
 *   node src/scripts/migrateAddressesOfInterest.js 6
 *     - Only migrates addresses from the 6% file
 */
async function migrateAddressesOfInterest(percentageFilter = null) {
  const db = await getDbClient()
  const collection = db.collection('addresses_of_interest')
  
  // Check if we already have addresses in MongoDB
  const existingCount = await collection.countDocuments()
  if (existingCount > 0) {
    console.log(`Collection already contains ${existingCount} addresses.`)
    
    const proceed = await confirmOverwrite()
    if (!proceed) {
      console.log('Migration aborted by user.')
      return
    }
    
    // Clear existing data if proceeding
    await collection.deleteMany({})
    console.log('Cleared existing addresses from MongoDB.')
  }
  
  // Determine which files to process
  const percentages = percentageFilter ? [percentageFilter] : [6, 8, 10]
  let totalImported = 0
  
  for (const pct of percentages) {
    // Load addresses from file
    const filename = `addresses_of_interest_${pct}pct.json`
    const filePath = path.join(process.cwd(), 'data', filename)
    
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`)
      continue
    }
    
    try {
      const fileContent = fs.readFileSync(filePath, 'utf8')
      let addresses = JSON.parse(fileContent)
      
      // Filter out any empty addresses or invalid ones
      addresses = addresses.filter(address => 
        address && typeof address === 'string' && address.trim().startsWith('0x')
      )
      
      console.log(`Loaded ${addresses.length} valid addresses from ${filename}`)
      
      // Format addresses as objects for MongoDB
      const addressDocuments = addresses.map(address => ({ 
        address: address.toLowerCase(),
        source: `${pct}pct`,
        importedAt: new Date()
      }))
      
      // Insert into MongoDB
      const result = await collection.insertMany(addressDocuments)
      
      console.log(`Inserted ${result.insertedCount} addresses from ${pct}% file`)
      totalImported += result.insertedCount
    } catch (error) {
      console.error(`Error processing ${filename}:`, error)
    }
  }
  
  // Create indexes after importing all data
  console.log('Creating indexes...')
  try {
    // Create a unique index on the address field
    await collection.createIndex({ address: 1 }, { unique: true })
    console.log('Created unique index on address field')
    
    // Create an index on the source field for filtering by percentage
    await collection.createIndex({ source: 1 })
    console.log('Created index on source field')
    
    // Create an index on importedAt for sorting
    await collection.createIndex({ importedAt: 1 })
    console.log('Created index on importedAt field')
  } catch (error) {
    console.error('Error creating indexes:', error)
  }
  
  console.log(`Migration complete. Total addresses imported: ${totalImported}`)
  return totalImported
}

// Simple function to ask for confirmation (CLI only)
function confirmOverwrite() {
  return new Promise(resolve => {
    const readline = require('readline').createInterface({
      input: process.stdin,
      output: process.stdout
    })
    
    readline.question('Addresses already exist in database. Overwrite? (y/N): ', answer => {
      readline.close()
      resolve(answer.toLowerCase() === 'y')
    })
  })
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const percentageFilter = process.argv[2] ? parseInt(process.argv[2]) : null
  
  migrateAddressesOfInterest(percentageFilter)
    .then(count => {
      if (count > 0) {
        console.log('Migration completed successfully!')
      }
      process.exit(0)
    })
    .catch(err => {
      console.error('Migration failed:', err)
      process.exit(1)
    })
}

export { migrateAddressesOfInterest } 