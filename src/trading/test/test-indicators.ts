import { getEMAs, CandleData } from '../indicators.js'
import dotenv from 'dotenv'

dotenv.config()

interface TestCase {
  name: string
  fn: () => Promise<void>
}

// Test both spot and futures instruments
const SPOT_PAIR = 'ETHUSD'
const FUTURES_PAIR = 'PF_SOLUSD'

const tests: TestCase[] = [
  {
    name: 'Spot market EMA calculation',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting spot market EMA calculation (${interval}m interval)...`)
      const result = await getEMAs(SPOT_PAIR, interval, [20, 50, 100, 200])
      console.log('Spot EMAs:', result)
      validateEMAResult(result, 'spot')
    }
  },
  {
    name: 'Futures market EMA calculation',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting futures market EMA calculation (${interval}m interval)...`)
      const result = await getEMAs(FUTURES_PAIR, interval, [20, 50, 100, 200])
      console.log('Futures EMAs:', result)
      validateEMAResult(result, 'futures')
    }
  },
  {
    name: 'Spot market trend detection',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting spot market trend detection (${interval}m interval)...`)
      const result = await getEMAs(SPOT_PAIR, interval, [20, 50, 100, 200])
      analyzeTrend(result)
    }
  },
  {
    name: 'Futures market trend detection',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting futures market trend detection (${interval}m interval)...`)
      const result = await getEMAs(FUTURES_PAIR, interval, [20, 50, 100, 200])
      analyzeTrend(result)
    }
  },
  {
    name: 'Spot market historical data validation',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting spot market historical data validation (${interval}m interval)...`)
      const result = await getEMAs(SPOT_PAIR, interval, [20, 50, 100, 200], 50)
      validateHistoricalData(result)
    }
  },
  {
    name: 'Futures market historical data validation',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting futures market historical data validation (${interval}m interval)...`)
      const result = await getEMAs(FUTURES_PAIR, interval, [20, 50, 100, 200], 50)
      validateHistoricalData(result)
    }
  },
  {
    name: 'Spot market OHLC data integrity',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting spot market OHLC data integrity (${interval}m interval)...`)
      const result = await getEMAs(SPOT_PAIR, interval, [20, 50, 100, 200], 10)
      validateOHLCData(result, 'spot')
    }
  },
  {
    name: 'Futures market OHLC data integrity',
    fn: async () => {
      const interval = 15
      console.log(`\nTesting futures market OHLC data integrity (${interval}m interval)...`)
      const result = await getEMAs(FUTURES_PAIR, interval, [20, 50, 100, 200], 10)
      validateOHLCData(result, 'futures')
    }
  }
]

// Helper functions for validation
function validateEMAResult(result: CandleData[], market: 'spot' | 'futures') {
  if (!result || !Array.isArray(result)) {
    throw new Error(`Invalid ${market} EMA structure`)
  }
  
  const validateCandle = (candle: CandleData) => {
    if (typeof candle.price !== 'number' || isNaN(candle.price)) {
      throw new Error(`Invalid ${market} price value`)
    }
    if (typeof candle.high !== 'number' || isNaN(candle.high)) {
      throw new Error(`Invalid ${market} high value`)
    }
    if (typeof candle.low !== 'number' || isNaN(candle.low)) {
      throw new Error(`Invalid ${market} low value`)
    }
    if (!(candle.timestamp instanceof Date)) {
      throw new Error(`Invalid ${market} timestamp`)
    }
    if (typeof candle.ema20 !== 'number' || isNaN(candle.ema20) ||
        typeof candle.ema50 !== 'number' || isNaN(candle.ema50) ||
        typeof candle.ema100 !== 'number' || isNaN(candle.ema100) ||
        typeof candle.ema200 !== 'number' || isNaN(candle.ema200)) {
      throw new Error(`Invalid ${market} EMA values`)
    }
    if (candle.high < candle.price || candle.low > candle.price) {
      throw new Error(`Invalid ${market} OHLC relationship: close price outside high-low range`)
    }
    if (candle.high < candle.low) {
      throw new Error(`Invalid ${market} OHLC relationship: high less than low`)
    }
  }
  
  result.forEach(validateCandle)
}

function analyzeTrend(result: CandleData[]) {
  const latest = result[result.length - 1]
  
  console.log('Latest EMAs:', {
    ema20: latest.ema20,
    ema50: latest.ema50,
    ema100: latest.ema100,
    ema200: latest.ema200,
    timestamp: latest.timestamp
  })
  
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

function validateHistoricalData(result: CandleData[]) {
  const minLength = 50
  if (result.length < minLength) {
    throw new Error(`Insufficient historical data: ${result.length} points (expected ${minLength})`)
  }
  
  const hasGaps = (values: number[]) => {
    return values.some((val, i) => {
      if (i === 0) return false
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

function validateOHLCData(result: CandleData[], market: 'spot' | 'futures' = 'spot') {
  result.forEach((candle, i) => {
    console.log(`Candle ${i}:`, {
      timestamp: candle.timestamp,
      high: candle.high,
      low: candle.low,
      close: candle.price
    })
    
    if (candle.high < candle.low) {
      throw new Error(`Invalid high-low range at index ${i}`)
    }
    if (candle.price > candle.high || candle.price < candle.low) {
      throw new Error(`Close price outside high-low range at index ${i}`)
    }
    
    const spread = ((candle.high - candle.low) / candle.low) * 100
    if (spread > 20) {
      console.warn(`Warning: Large price spread (${spread.toFixed(2)}%) at index ${i}`)
    }
  })
  
  // Skip time sequence check for futures market as it might have variable intervals
  if (market === 'spot') {
    for (let i = 1; i < result.length; i++) {
      const curr = result[i]
      const prev = result[i - 1]
      const timeDiff = curr.timestamp.getTime() - prev.timestamp.getTime()
      const expectedDiff = 15 * 60 * 1000 // 15 minutes in milliseconds
      
      if (Math.abs(timeDiff - expectedDiff) > 1000) { // Allow 1 second tolerance
        throw new Error(`Unexpected time gap between candles at index ${i}`)
      }
    }
  }
  
  console.log('OHLC data integrity validated')
}

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