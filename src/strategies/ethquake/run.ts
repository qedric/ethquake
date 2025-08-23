import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress.js'
import { countTransactionsByHour } from './scripts/txCountByHour.js'
import { executeTradeStrategy } from './strategy.js'
import { getDb } from '../../lib/mongodb.js'
import { selectDatabase } from './database/dbSelector.js'
import { syncPositionWithExchange } from '../../trading/positions.js'

let isInitialized = false
let initializationPromise: Promise<void> | null = null
let selectedDbName: string | null = null

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
      selectedDbName = await selectDatabase()
      
      // Connect to MongoDB - getDb handles the connection internally
      await getDb(selectedDbName as string)
      
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
    // Get a database connection
    const db = await getDb(selectedDbName as string)

    // Check and update position status first (skip if disabled for staging)
    if (process.env.DISABLE_EXCHANGE !== '1') {
      await syncPositionWithExchange('ethquake', 'PF_ETHUSD')
    } else {
      console.log('[Strategy: ethquake] Skipping exchange sync (DISABLE_EXCHANGE=1)')
    }

    // Update transactions data
    const txResult = await updateTransactionsByAddressesOfInterest({
      existingDb: db
    })

    // Run analysis
    const analysisResults = await countTransactionsByHour(db)

    // Only execute trading strategy in production and when exchange is enabled
    if (process.env.NODE_ENV === 'production' && process.env.DISABLE_EXCHANGE !== '1') {
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