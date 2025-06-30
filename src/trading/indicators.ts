import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

/**
 * Calculates Simple Moving Average from price data
 * @param {Array} prices - Array of closing prices
 * @param {Number} period - SMA period length
 * @returns {Number} - The SMA value
 */
function calculateSMA(prices: number[], period: number) {
  if (prices.length < period) {
    throw new Error(`Not enough price data to calculate ${period} SMA`)
  }

  // Get last N prices based on period
  const relevantPrices = prices.slice(prices.length - period)
  
  // Calculate sum of prices
  let sum = 0
  for (let i = 0; i < relevantPrices.length; i++) {
    sum += relevantPrices[i]
  }
  
  // Calculate average
  return sum / period
}

/**
 * Calculates Exponential Moving Average from price data
 * @param {Array} prices - Array of closing prices
 * @param {Number} period - EMA period length
 * @returns {Number} - The EMA value
 */
function calculateEMA(prices: number[], period: number) {
  if (prices.length < period) {
    throw new Error(`Not enough price data to calculate ${period} EMA`)
  }

  // Need enough data for the period plus some warmup
  const minLength = period * 3
  if (prices.length < minLength) {
    throw new Error(`For reliable ${period} EMA calculation, need at least ${minLength} data points, got ${prices.length}`)
  }

  // Multiplier: 2/(period+1)
  const multiplier = 2 / (period + 1)
  
  // Start with SMA for first EMA value
  let ema = calculateSMA(prices.slice(0, period), period)
  
  // Calculate EMA for remaining prices
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] * multiplier) + (ema * (1 - multiplier))
  }
  
  return ema
}

/**
 * Fetches OHLC data from Kraken Spot API
 * @param {String} pair - Asset pair to get data for (e.g., 'ETHUSD')
 * @param {Number} interval - Interval in minutes (1, 5, 15, 30, 60, 240, 1440, 10080, 21600)
 * @param {Number} hoursNeeded - How many hours of historical data needed
 * @returns {Array} - Array of closing prices
 */

export type CandleData = {
  price: number
  high: number
  low: number
  timestamp: Date
  [key: `ema${number}`]: number
}

// Helper to determine if a symbol is a futures instrument
function isFuturesSymbol(symbol: string): boolean {
  return symbol.startsWith('PF_')
}

// Convert minutes to futures API resolution string
function minutesToResolution(minutes: number): string {
  const validMinutes = [1, 5, 15, 30, 60, 240, 720, 1440, 10080]
  const validResolutions = ['1m', '5m', '15m', '30m', '1h', '4h', '12h', '1d', '1w']
  
  const index = validMinutes.indexOf(minutes)
  if (index !== -1) {
    return validResolutions[index]
  }
  
  // Find the closest valid resolution
  const closest = validMinutes.reduce((prev, curr) => 
    Math.abs(curr - minutes) < Math.abs(prev - minutes) ? curr : prev
  )
  console.warn(`Warning: ${minutes} minute interval not supported by Futures API. Using closest supported interval: ${closest} minutes`)
  return minutesToResolution(closest)
}

async function getFuturesCandles(
  symbol: string,
  interval: number,
  hoursNeeded: number
): Promise<{ timestamp: number; price: number; high: number; low: number }[]> {
  // Convert minutes to seconds for the API
  const since = Math.floor(Date.now() / 1000) - hoursNeeded * 3600
  
  try {
    // Use the correct futures API endpoint with proper resolution format
    const resolution = minutesToResolution(interval)
    const response = await axios.get(
      `https://futures.kraken.com/api/charts/v1/trade/${symbol}/${resolution}?from=${since}`
    )
    
    if (!response.data || !response.data.candles) {
      throw new Error('Unexpected response format from Kraken Futures API')
    }

    return response.data.candles.map((candle: any) => ({
      timestamp: candle.time,
      price: parseFloat(candle.close),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low)
    }))
  } catch (error) {
    console.error('Error fetching futures data:', error)
    throw error
  }
}

async function getSpotCandles(
  pair: string,
  interval: number,
  hoursNeeded: number
): Promise<{ timestamp: number; price: number; high: number; low: number }[]> {
  try {
    const response = await axios.get(
      `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${Math.floor(Date.now() / 1000) - hoursNeeded * 3600}`
    )
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(`Kraken API error: ${response.data.error.join(', ')}`)
    }
    
    const pairData = Object.keys(response.data.result)
      .filter(key => key !== 'last')
      .map(key => response.data.result[key])[0]
    
    if (!pairData || !Array.isArray(pairData)) {
      throw new Error('Unexpected response format from Kraken API')
    }
    
    return pairData.map((candle: any) => ({
      timestamp: parseInt(candle[0]),
      price: parseFloat(candle[4]),
      high: parseFloat(candle[2]),
      low: parseFloat(candle[3])
    }))
  } catch (error) {
    console.error('Error fetching spot data:', error)
    throw error
  }
}

//Fetches technical indicators from Kraken API and calculates EMAs
export async function getEMAs(
  pair: string = 'ETHUSD',
  interval: number = 15,
  emaPeriods: number[] = [20, 50, 100],
  lookbackCandles: number = 1
): Promise<CandleData[]> {
  try {
    // Find the longest EMA period to determine data needs
    const maxPeriod = Math.max(...emaPeriods)
    const minDataPoints = maxPeriod * 3
    const hoursNeeded = Math.ceil((minDataPoints + lookbackCandles) * interval / 60)

    // Get candles based on instrument type
    const candles = isFuturesSymbol(pair)
      ? await getFuturesCandles(pair, interval, hoursNeeded)
      : await getSpotCandles(pair, interval, hoursNeeded)

    if (!candles || candles.length < lookbackCandles + 1) {
      throw new Error(`Failed to fetch enough price data. Need at least ${lookbackCandles + 1} candles`)
    }

    if (candles.length < minDataPoints + lookbackCandles) {
      throw new Error(`Not enough price data for reliable EMA calculations: got ${candles.length}, need at least ${minDataPoints + lookbackCandles}`)
    }

    // Extract price arrays
    const prices = candles.map(c => c.price)
    const recentCandles = candles.slice(-lookbackCandles)
    
    // Calculate EMAs for each historical point
    return recentCandles.map((candle, idx) => {
      const dataEndIndex = prices.length - lookbackCandles + idx + 1
      const dataStartIndex = Math.max(0, dataEndIndex - minDataPoints)
      const pricesUpToThis = prices.slice(dataStartIndex, dataEndIndex)
      
      const emas = emaPeriods.reduce((acc, period) => {
        acc[`ema${period}`] = calculateEMA(pricesUpToThis, period)
        return acc
      }, {} as Record<string, number>)

      return {
        price: candle.price,
        high: candle.high,
        low: candle.low,
        ...emas,
        timestamp: new Date(candle.timestamp * 1000)
      }
    })
  } catch (error) {
    console.error('Error fetching indicators:', error)
    throw error
  }
} 