import { getDb } from '../lib/mongodb.js'
import { placeOrder } from './kraken.js'
import { getTechnicalIndicators } from './indicators.js'

/**
 * Executes the trading strategy based on:
 * 1. EthQuake signals (address activity spikes)
 * 2. Technical indicators (EMAs)
 * 
 * Strategy:
 * - Enter when there are two consecutive hours with counts over 20
 * - Use EMAs (20, 50, 100, 200) to determine direction
 */
export async function executeTradeStrategy() {
  const db = await getDb()
  
  try {
    // Get the most recent analysis results
    const recentResults = await db.collection('analysis_results')
      .find({})
      .sort({ created_at: -1 })
      .limit(24) // Last 24 hours of data
      .toArray()
    
    if (recentResults.length < 2) {
      console.log('Not enough analysis data to make trading decisions')
      return
    }
    
    // Sort by date_hour to ensure chronological order
    recentResults.sort((a, b) => {
      if (a.date < b.date) return -1
      if (a.date > b.date) return 1
      return parseInt(a.hour) - parseInt(b.hour)
    })
    
    // Check for signal - two consecutive hours with counts over 20
    // (Yes, I know this is a ridiculously simplistic strategy)
    const SIGNAL_THRESHOLD = 20
    let signalDetected = false
    let signalHour = null
    
    for (let i = 1; i < recentResults.length; i++) {
      if (recentResults[i].count > SIGNAL_THRESHOLD && 
          recentResults[i-1].count > SIGNAL_THRESHOLD) {
        signalDetected = true
        signalHour = recentResults[i].date_hour
        break
      }
    }
    
    if (!signalDetected) {
      console.log('No trading signal detected in recent data')
      return
    }
    
    console.log(`Signal detected at ${signalHour}`)
    
    // Get technical indicators to determine direction
    const indicators = await getTechnicalIndicators()
    const { ema20, ema50, ema100, ema200, price } = indicators
    
    // Determine trade direction based on EMAs
    let direction = 'none'
    
    // Basic trend determination
    // Price above all EMAs = bullish
    if (price > ema20 && price > ema50 && price > ema100 && price > ema200) {
      direction = 'buy'
    } 
    // Price below all EMAs = bearish
    else if (price < ema20 && price < ema50 && price < ema100 && price < ema200) {
      direction = 'sell'
    }
    // Additional logic: look at EMA alignment
    else if (ema20 > ema50 && ema50 > ema100) {
      direction = 'buy'  // Bullish alignment
    } else if (ema20 < ema50 && ema50 < ema100) {
      direction = 'sell' // Bearish alignment
    }
    
    if (direction === 'none') {
      console.log('No clear direction from technical indicators, not trading')
      return
    }
    
    // Check if we already have an active signal for this hour
    const existingSignal = await db.collection('trading_signals')
      .findOne({ signal_hour: signalHour })
    
    if (existingSignal) {
      console.log(`Already processed signal for ${signalHour}`)
      return
    }
    
    // Place order
    console.log(`Placing ${direction} order based on signal at ${signalHour}`)
    const orderResult = await placeOrder(direction, 0.001) // 0.1 ETH position size
    
    // Record the signal and order in the database
    await db.collection('trading_signals').insertOne({
      signal_hour: signalHour,
      created_at: new Date(),
      direction: direction,
      ema_data: indicators,
      order_id: orderResult?.orderId || null,
      status: orderResult?.status || 'failed',
      error: orderResult?.error || null
    })
    
    return {
      signalHour,
      direction,
      orderResult
    }
    
  } catch (error) {
    console.error('Error executing trading strategy:', error)
    throw error
  }
} 