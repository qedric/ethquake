import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress.js'
import { countTransactionsByHour } from './scripts/txCountByHour.js'
import { executeTradeStrategy } from './strategy.js'

export async function runPipelineTask() {
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