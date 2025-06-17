import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress.js'
import { countTransactionsByHour } from './scripts/txCountByHour.js'
import { executeTradeStrategy } from './strategy.js'
import { connectToDatabase } from './database/mongodb.js'
import { selectDatabase } from './database/dbSelector.js'

let isInitialized = false
let initializationPromise: Promise<void> | null = null

async function initialize() {
  if (isInitialized) return
  
  // If initialization is already in progress, wait for it
  if (initializationPromise) {
    await initializationPromise
    return
  }

  // Create a new initialization promise
  initializationPromise = (async () => {
    try {
      // Select database in development mode
      const dbName = await selectDatabase()
      
      // Connect to MongoDB
      await connectToDatabase(typeof dbName === 'string' ? dbName : undefined)
      
      isInitialized = true
    } catch (error) {
      console.error('Failed to initialize ethquake strategy:', error)
      throw error
    } finally {
      initializationPromise = null
    }
  })()

  await initializationPromise
}

export async function runPipelineTask() {
  if (!isInitialized) {
    await initialize()
  }

  try {
    // Update transactions data
    const txResult = await updateTransactionsByAddressesOfInterest()

    // Run analysis
    const analysisResults = await countTransactionsByHour()

    // Only execute trading strategy in production
    if (process.env.NODE_ENV === 'production') {
      await executeTradeStrategy()
    }

    return {
      success: true,
      newTransactionsCount: txResult?.newTransactionsCount || 0,
      analysisCount: analysisResults?.length || 0
    }
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) }
  }
} 