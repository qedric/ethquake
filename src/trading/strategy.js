import { getDb , connectToDatabase } from '../lib/mongodb.js'
import { placeOrder } from './kraken.js'
import { getTechnicalIndicators } from './indicators.js'

/**
 * Executes the trading strategy based on:
 * 1. Ethquake signals (address activity spikes)
 * 2. Technical indicators (EMAs)
 * 
 * Strategy:
 * - Enter when there are two consecutive hours with counts over 20
 * - Use EMAs (20, 50, 100, 200) to determine direction
 */
export async function executeTradeStrategy() {
  try {
    // First try to get the database
    let db = null
    let connectionAttempts = 0
    const MAX_ATTEMPTS = 3
    
    while (!db && connectionAttempts < MAX_ATTEMPTS) {
      try {
        connectionAttempts++
        await connectToDatabase() // Always reconnect first
        db = await getDb()
      } catch (error) {
        console.log(`Database connection attempt ${connectionAttempts} failed - ${error.message}`)
        if (connectionAttempts >= MAX_ATTEMPTS) {
          throw new Error(`Failed to connect to database after ${MAX_ATTEMPTS} attempts`)
        }
        // Wait a bit before retrying
        await new Promise(resolve => setTimeout(resolve, 1000 * connectionAttempts))
      }
    }
    
    // Get the most recent analysis results
    const now = new Date()
    const twentyFourHoursAgo = new Date(now)
    twentyFourHoursAgo.setHours(twentyFourHoursAgo.getHours() - 24)
    
    const recentResults = await db.collection('transactions_per_hour')
      .find({ 
        timestamp: { $gte: twentyFourHoursAgo, $lte: now }
      })
      .sort({ timestamp: 1 }) // Sort chronologically 
      .toArray()
    
    if (recentResults.length < 2) {
      console.log('Not enough analysis data to make trading decisions')
      return
    }
    
    // Check for signal - two consecutive hours with counts over 20
    const SIGNAL_THRESHOLD = 20
    let signalDetected = false
    let signalHour = null
    
    for (let i = 1; i < recentResults.length; i++) {
      if (recentResults[i].count > SIGNAL_THRESHOLD && 
          recentResults[i-1].count > SIGNAL_THRESHOLD) {
        signalDetected = true
        signalHour = recentResults[i].timestamp
        break
      }
    }
    
    if (!signalDetected) {
      console.log('No trading signal detected in recent data')
      return recentResults
    }
    
    console.log(`Signal detected at ${signalHour.toISOString()}`)
    
    // Get technical indicators to determine direction
    const indicators = await getTechnicalIndicators()
    const { ema20, ema50, ema100, ema200 } = indicators
    
    // Determine trade direction based on EMAs
    let direction = 'none'
    
    // Check if EMAs are in order for a bullish trend
    if (ema20 > ema50 && ema50 > ema100 && ema100 > ema200) {
      direction = 'buy'
    } 
    // Check if EMAs are in order for a bearish trend
    else if (ema20 < ema50 && ema50 < ema100 && ema100 < ema200) {
      direction = 'sell'
    }
    
    if (direction === 'none') {
      console.log('No clear direction from technical indicators, not trading')
      return
    }
    
    // Check if we already have an active signal for this hour
    const existingSignal = await db.collection('trading_signals')
      .findOne({ 
        signal_hour: { 
          $gte: new Date(signalHour.getTime()), 
          $lt: new Date(signalHour.getTime() + 3600000) // One hour later
        } 
      })
    
    if (existingSignal) {
      console.log(`Already processed signal for ${signalHour.toISOString()}`)
      return
    }
    
    // Place order
    console.log(`Placing ${direction} order based on signal at ${signalHour.toISOString()}`)
    const orderResult = await placeOrder(direction, 0.001, { trailingStop: 0.04 }) // 0.1 ETH position size with 4% trailing stop
    
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