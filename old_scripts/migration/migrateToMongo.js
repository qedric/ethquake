import fs from 'fs'
import path from 'path'
import { getDbClient } from '../../src/lib/mongodb.js'

const DATA_DIR = path.join(process.cwd(), 'data')
const MONITOR_DIR = path.join(process.cwd(), 'data/monitor')

async function migrateData() {
  console.log('Starting migration to MongoDB...')
  const db = await getDbClient()
  
  // Migrate price movement timestamps
  await migratePriceMovements(db)
  
  // Migrate transactions by addresses of interest
  await migrateTransactions(db)
  
  // Migrate analysis results
  await migrateAnalysisResults(db)
  
  console.log('Migration completed!')
}

async function migratePriceMovements(db) {
  try {
    const priceMoveFiles = [
      'percentage_price_movements_timestamps_6pct.json',
      'percentage_price_movements_timestamps_8pct.json',
      'percentage_price_movements_timestamps_10pct.json'
    ]
    
    for (const file of priceMoveFiles) {
      const filePath = path.join(DATA_DIR, file)
      if (!fs.existsSync(filePath)) continue
      
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      const percentage = file.includes('6pct') ? 6 : file.includes('8pct') ? 8 : 10
      
      const priceMovements = data.map(timestamp => ({
        timestamp: parseInt(timestamp),
        datetime: new Date(parseInt(timestamp) * 1000),
        percentage: percentage
      }))
      
      if (priceMovements.length > 0) {
        await db.collection('price_movements').insertMany(priceMovements)
        console.log(`Migrated ${priceMovements.length} price movements (${percentage}%)`)
      }
    }
  } catch (error) {
    console.error('Error migrating price movements:', error)
  }
}

async function migrateTransactions(db) {
  try {
    const txFiles = fs.readdirSync(MONITOR_DIR)
      .filter(file => file.includes('transactions_by_addresses') && file.endsWith('.json'))
    
    for (const file of txFiles) {
      const filePath = path.join(MONITOR_DIR, file)
      if (!fs.existsSync(filePath)) continue
      
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'))
      
      // First, collect all unique addresses of interest
      const addressesOfInterest = new Set()
      for (const tx of data) {
        addressesOfInterest.add(tx.from_address)
        addressesOfInterest.add(tx.to_address)
      }
      
      // Insert addresses of interest
      const addressDocs = Array.from(addressesOfInterest).map(address => ({
        address,
        added_at: new Date(),
        source_file: file
      }))
      
      if (addressDocs.length > 0) {
        // Use updateMany with upsert to avoid duplicates
        for (const doc of addressDocs) {
          await db.collection('addresses_of_interest').updateOne(
            { address: doc.address },
            { $set: doc },
            { upsert: true }
          )
        }
        console.log(`Migrated ${addressDocs.length} addresses of interest`)
      }
      
      // Insert transactions with added metadata
      const transactions = data.map(tx => ({
        ...tx,
        value_in_eth: tx.value / 1e18, // Convert wei to ETH for easier querying
        block_datetime: new Date(tx.block_timestamp * 1000),
        source_file: file,
        migrated_at: new Date()
      }))
      
      if (transactions.length > 0) {
        // Use hash as unique identifier to avoid duplicates
        for (const tx of transactions) {
          await db.collection('transactions').updateOne(
            { hash: tx.hash },
            { $set: tx },
            { upsert: true }
          )
        }
        console.log(`Migrated ${transactions.length} transactions from ${file}`)
      }
    }
  } catch (error) {
    console.error('Error migrating transactions:', error)
  }
}

async function migrateAnalysisResults(db) {
  try {
    // Parse the analysis results format from your code example
    // Format: "10/03/25 - 06,7" (DD/MM/YY - HH,count)
    const analysisFiles = fs.readdirSync(DATA_DIR)
      .filter(file => file.includes('analysis_results') && file.endsWith('.txt'))
    
    for (const file of analysisFiles) {
      const filePath = path.join(DATA_DIR, file)
      if (!fs.existsSync(filePath)) continue
      
      const data = fs.readFileSync(filePath, 'utf8').split('\n')
      
      const results = data
        .filter(line => line.trim())
        .map(line => {
          const [dateHour, count] = line.split(',')
          const [date, hour] = dateHour.split(' - ')
          
          // Parse date in DD/MM/YY format
          const [day, month, yearShort] = date.split('/')
          const year = `20${yearShort}` // Assuming 20xx for years
          
          // Create a Date object
          const dateObj = new Date(`${year}-${month}-${day}T${hour}:00:00Z`)
          
          return {
            date_hour: dateHour,
            date,
            hour: parseInt(hour),
            count: parseInt(count),
            timestamp: Math.floor(dateObj.getTime() / 1000),
            datetime: dateObj,
            source_file: file
          }
        })
      
      if (results.length > 0) {
        await db.collection('analysis_results').insertMany(results)
        console.log(`Migrated ${results.length} analysis results from ${file}`)
      }
    }
  } catch (error) {
    console.error('Error migrating analysis results:', error)
  }
}

// Run the migration
migrateData().catch(console.error) 