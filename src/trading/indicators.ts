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
async function getKrakenOHLCData(pair = 'ETHUSD', interval = 60, hoursNeeded = 200) {
  try {
    // Calculate the 'since' timestamp (current time minus needed hours)
    // Convert hours to seconds and account for the interval
    const now = Math.floor(Date.now() / 1000)
    const secondsNeeded = hoursNeeded * 3600
    const since = now - secondsNeeded
    
    const response = await axios.get(
      `https://api.kraken.com/0/public/OHLC?pair=${pair}&interval=${interval}&since=${since}`
    )
    
    if (response.data.error && response.data.error.length > 0) {
      throw new Error(`Kraken API error: ${response.data.error.join(', ')}`)
    }
    
    // Find the first property in the result object that's not "last"
    const pairData = Object.keys(response.data.result)
      .filter(key => key !== 'last')
      .map(key => response.data.result[key])[0]
    
    if (!pairData || !Array.isArray(pairData)) {
      throw new Error('Unexpected response format from Kraken API')
    }
    
    // Kraken returns data in format [time, open, high, low, close, vwap, volume, count]
    // Extract just the closing prices (index 4)
    return pairData.map((candle: any) => parseFloat(candle[4]))
  } catch (error) {
    console.error('Error fetching Kraken OHLC data:', error)
    throw error
  }
}

/**
 * Fetches technical indicators from Kraken API and calculates EMAs
 */
export async function getTechnicalIndicators() {
  try {
    // For 100 EMA on 15min timeframe, we want at least 3x that amount of data points for accuracy
    // 100 periods * 15min = 1500min = 25 hours, so we'll get 75 hours of data
    const prices = await getKrakenOHLCData('ETHUSD', 15, 75)
    
    if (!prices || prices.length === 0) {
      throw new Error('Failed to fetch price data from Kraken')
    }
    
    if (prices.length < 300) {
      throw new Error(`Not enough price data for reliable EMA calculations: got ${prices.length}, need at least 300`)
    }
    
    // Current price is the last price in the array
    const currentPrice = prices[prices.length - 1]
    
    // Calculate EMAs
    const ema20 = calculateEMA(prices, 20)
    const ema50 = calculateEMA(prices, 50)
    const ema100 = calculateEMA(prices, 100)
    
    return {
      price: currentPrice,
      ema20,
      ema50,
      ema100,
      timestamp: new Date()
    }
  } catch (error) {
    console.error('Error fetching indicators:', error)
    throw error
  }
} 