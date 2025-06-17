import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress'
import { countTransactionsByHour } from './scripts/txCountByHour'
import { executeTradeStrategy } from './strategy'
import { getDb } from './database/mongodb'

export async function runPipelineTask() {
  try {
    const db = await getDb()
    const client = db.client

    // Update transactions data
    const txResult = await updateTransactionsByAddressesOfInterest({
      existingDb: db,
      existingClient: client
    })

    // Run analysis
    const analysisResults = await countTransactionsByHour(db, client)

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