import { executeTradeStrategy } from '../strategies/ethquake/strategy.js'
import dotenv from 'dotenv'

// Load environment variables - you better have these set up
dotenv.config()

async function runTest() {
  try {
    console.log('Starting trade strategy test...')
    const result = await executeTradeStrategy()
    console.log('Trade strategy execution completed:', result)
    process.exit(0)
  } catch (error) {
    console.error('Test failed:', error)
    process.exit(1)
  }
  
}

runTest() 