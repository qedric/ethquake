import dotenv from 'dotenv'
import { getDb } from '../../../lib/mongodb.js'
import { updateTransactionsByAddressesOfInterest } from './updateTransactionsByAddress.js'
import { countTransactionsByHour } from './txCountByHour.js'

// Load env vars
dotenv.config()

/**
 * Runs the data pipeline using collection B and optional timestamp range
 * @param {number} [fromTimestamp] - Optional start timestamp in seconds
 * @param {number} [toTimestamp] - Optional end timestamp in seconds
 */
async function runPipelineB(fromTimestamp: number | null | undefined = null, toTimestamp: number | null | undefined = null) {
  console.log('Running data pipeline B (TESTING ONLY):', new Date().toISOString())
  if (fromTimestamp) {
    console.log(`Using start timestamp: ${fromTimestamp}`)
  }
  if (toTimestamp) {
    console.log(`Using end timestamp: ${toTimestamp}`)
  }
  
  let client: any | null = null
  
  try {
    // Connect to the B database
    const db = await getDb('ethquake_b')
    client = (db as any).client
    
    // Update transactions data using collection B
    console.log('Updating transactions data for collection B...')
    const txResult = await updateTransactionsByAddressesOfInterest({
      minEthValue: parseInt(process.env.MIN_ETH_VALUE || '100'),
      fromTimestamp,
      toTimestamp,
      existingDb: db
    })
    console.log(`Added ${txResult.newTransactionsCount} new transactions to collection B`)
    
    // Run analysis for collection B
    console.log('Running transaction analysis for collection B...')
    const analysisResults = await countTransactionsByHour(db, client) as any[] // Pass db and useCollectionB=true
    console.log(`Analysis complete with ${analysisResults?.length || 0} hourly results for collection B`)
    
    // Skip trade execution for Collection B
    console.log('Skipping trade execution for Collection B (testing only)')
    
    return { success: true }
  } catch (error) {
    console.error('Error in data pipeline B:', error)
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  } finally {
    // Close the MongoDB connection
    if (client) {
      console.log('Closing MongoDB connection...')
      await client.close()
      console.log('MongoDB connection closed')
    }
  }
}

// Run the script if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const fromTimestamp = process.argv[2] ? parseInt(process.argv[2]) : null
  const toTimestamp = process.argv[3] ? parseInt(process.argv[3]) : null
  
  runPipelineB(fromTimestamp, toTimestamp)
    .then(result => {
      if (result.success) {
        console.log('Pipeline B completed successfully')
      } else {
        console.error('Pipeline B failed:', result.error)
        process.exit(1)
      }
    })
    .catch(err => {
      console.error('Failed to run pipeline B:', err)
      process.exit(1)
    })
}

export { runPipelineB } 