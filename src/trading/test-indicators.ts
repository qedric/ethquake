import { getTechnicalIndicators } from './indicators.js'
import dotenv from 'dotenv'

// Load environment variables - required for proper operation
dotenv.config()

async function runIndicatorTest() {
  try {
    console.log('Starting technical indicator calculations test...')
    const result = await getTechnicalIndicators()
    console.log('Technical indicators fetched:', result)
    process.exit(0)
  } catch (error) {
    console.error('Technical indicator test failed:', error)
    process.exit(1)
  }
}

runIndicatorTest() 