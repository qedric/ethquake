import { getEMAs, CandleData } from '../indicators.js'
import dotenv from 'dotenv'

dotenv.config()

interface TestCase {
  name: string
  fn: () => Promise<void>
}

const tests: TestCase[] = [
  {
    name: 'Basic EMA calculation',
    fn: async () => {
      console.log('\nTesting basic EMA calculation...')
      const result = await getEMAs('ETHUSD', 15, [20, 50, 100, 200])
      console.log('EMAs:', result)
      
      // Validate EMA structure
      if (!result || !Array.isArray(result)) {
        throw new Error('Invalid EMA structure')
      }
      
      // Validate EMA values
      const validateCandle = (candle: CandleData) => {
        if (typeof candle.price !== 'number' || isNaN(candle.price)) {
          throw new Error('Invalid price value')
        }
        if (!(candle.timestamp instanceof Date)) {
          throw new Error('Invalid timestamp')
        }
        if (typeof candle.ema20 !== 'number' || isNaN(candle.ema20) ||
            typeof candle.ema50 !== 'number' || isNaN(candle.ema50) ||
            typeof candle.ema100 !== 'number' || isNaN(candle.ema100) ||
            typeof candle.ema200 !== 'number' || isNaN(candle.ema200)) {
          throw new Error('Invalid EMA values')
        }
      }
      
      result.forEach(validateCandle)
    }
  },
  {
    name: 'EMA trend detection',
    fn: async () => {
      console.log('\nTesting EMA trend detection...')
      const result = await getEMAs('ETHUSD', 15, [20, 50, 100, 200])
      
      // Get the most recent values
      const latest = result[result.length - 1]
      
      console.log('Latest EMAs:', {
        ema20: latest.ema20,
        ema50: latest.ema50,
        ema100: latest.ema100,
        ema200: latest.ema200
      })
      
      // Check if EMAs are properly ordered (either ascending or descending)
      const isAscending = latest.ema20 >= latest.ema50 && 
                         latest.ema50 >= latest.ema100 && 
                         latest.ema100 >= latest.ema200
      
      const isDescending = latest.ema20 <= latest.ema50 && 
                          latest.ema50 <= latest.ema100 && 
                          latest.ema100 <= latest.ema200
      
      console.log('Trend:', isAscending ? 'Bullish' : isDescending ? 'Bearish' : 'Mixed')
      
      if (!isAscending && !isDescending) {
        console.log('Note: EMAs are in a mixed state (normal during trend changes)')
      }
    }
  },
  {
    name: 'Historical data validation',
    fn: async () => {
      console.log('\nTesting historical data validation...')
      // Request more historical data
      const result = await getEMAs('ETHUSD', 15, [20, 50, 100, 200], 50)
      
      // Check we have enough historical data
      const minLength = 50 // We should have at least this many data points
      if (result.length < minLength) {
        throw new Error(`Insufficient historical data: ${result.length} points (expected ${minLength})`)
      }
      
      // Check for gaps in the data
      const hasGaps = (values: number[]) => {
        return values.some((val, i) => {
          if (i === 0) return false
          // Check for unreasonable jumps (more than 50% change)
          const percentChange = Math.abs((val - values[i-1]) / values[i-1] * 100)
          return percentChange > 50
        })
      }
      
      const ema20Values = result.map(c => c.ema20)
      const ema50Values = result.map(c => c.ema50)
      const ema100Values = result.map(c => c.ema100)
      const ema200Values = result.map(c => c.ema200)
      
      if (hasGaps(ema20Values)) throw new Error('Gaps detected in EMA20')
      if (hasGaps(ema50Values)) throw new Error('Gaps detected in EMA50')
      if (hasGaps(ema100Values)) throw new Error('Gaps detected in EMA100')
      if (hasGaps(ema200Values)) throw new Error('Gaps detected in EMA200')
      
      console.log(`Validated ${result.length} historical data points`)
    }
  }
]

async function runTests() {
  console.log('Starting technical indicator tests...')
  let passed = 0
  let failed = 0
  
  for (const test of tests) {
    try {
      console.log(`\n=== Running test: ${test.name} ===`)
      await test.fn()
      console.log(`✅ ${test.name} passed`)
      passed++
    } catch (error) {
      console.error(`❌ ${test.name} failed:`, error)
      failed++
    }
  }
  
  console.log(`\n=== Test Summary ===`)
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${tests.length}`)
  
  if (failed > 0) process.exit(1)
  process.exit(0)
}

// Only run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests()
} 