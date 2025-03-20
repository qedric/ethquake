import { getDbClient } from '../../src/lib/mongodb.js'

async function setupIndexes() {
  try {
    const db = await getDbClient()
    
    // Transactions collection indexes
    await db.collection('transactions').createIndex({ hash: 1 }, { unique: true })
    await db.collection('transactions').createIndex({ from_address: 1 })
    await db.collection('transactions').createIndex({ to_address: 1 })
    await db.collection('transactions').createIndex({ block_timestamp: 1 })
    await db.collection('transactions').createIndex({ value_in_eth: 1 })
    
    // Addresses of interest index
    await db.collection('addresses_of_interest').createIndex({ address: 1 }, { unique: true })
    
    // Analysis results indexes
    await db.collection('analysis_results').createIndex({ datetime: 1 })
    await db.collection('analysis_results').createIndex({ count: 1 })
    
    // Price movements index
    await db.collection('price_movements').createIndex({ timestamp: 1 })
    await db.collection('price_movements').createIndex({ percentage: 1 })
    
    console.log('All indexes created successfully!')
  } catch (error) {
    console.error('Error setting up indexes:', error)
  }
}

setupIndexes().catch(console.error) 