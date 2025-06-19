import { executeTradeStrategy } from '../../strategies/ethquake/strategy.js'
import { getEMAs } from '../indicators.js'
import { hasOpenPosition } from '../kraken.js'
import dotenv from 'dotenv'

dotenv.config()

interface TestCase {
  name: string
  fn: () => Promise<void>
}

const tests: TestCase[] = [
  {
    name: 'Strategy execution',
    fn: async () => {
      console.log('\nTesting strategy execution...')
      const result = await executeTradeStrategy()
      console.log('Strategy result:', result)
      
      if (!result) {
        throw new Error('No result returned from strategy')
      }
    }
  },
  {
    name: 'Strategy with existing position',
    fn: async () => {
      console.log('\nTesting strategy with existing position...')
      // First check if we have a position
      const hasPosition = await hasOpenPosition('PF_ETHUSD')
      console.log('Has existing position:', hasPosition)
      
      // Run strategy
      const result = await executeTradeStrategy()
      console.log('Strategy result:', result)
      
      // Verify position state hasn't changed if we had one
      const hasPositionAfter = await hasOpenPosition('PF_ETHUSD')
      if (hasPosition !== hasPositionAfter) {
        throw new Error('Position state changed unexpectedly')
      }
    }
  },
  {
    name: 'Strategy signal generation',
    fn: async () => {
      console.log('\nTesting strategy signal generation...')
      // Get current EMAs
      const emaData = await getEMAs('ETHUSD', 15, [20, 50, 100, 200])
      const latest = emaData[emaData.length - 1]
      
      console.log('Current EMAs:', {
        ema20: latest.ema20,
        ema50: latest.ema50,
        ema100: latest.ema100,
        ema200: latest.ema200
      })
      
      // Run strategy
      const result = await executeTradeStrategy()
      console.log('Strategy result:', result)
      
      // Log the relationship between EMAs and strategy decision
      const isAscending = latest.ema20 >= latest.ema50 && 
                         latest.ema50 >= latest.ema100 && 
                         latest.ema100 >= latest.ema200
      
      const isDescending = latest.ema20 <= latest.ema50 && 
                          latest.ema50 <= latest.ema100 && 
                          latest.ema100 <= latest.ema200
      
      console.log('Market structure:', isAscending ? 'Bullish' : isDescending ? 'Bearish' : 'Mixed')
    }
  }
]

async function runTests() {
  console.log('Starting strategy tests...')
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
  
  console.log('\n=== Test Summary ===')
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