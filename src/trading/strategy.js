import { getDb , connectToDatabase } from '../lib/mongodb.js'
import { placeOrder } from './kraken.js'
import { getTechnicalIndicators } from './indicators.js'

const COOLDOWN_HOURS = 48
const SIGNAL_THRESHOLD = 20
const POSITION_SIZE = 0.5

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
    
    // Check for any trades within cooldown period
    const cooldownStart = new Date(Date.now() - (COOLDOWN_HOURS * 60 * 60 * 1000))
    const recentTrades = await db.collection('trading_signals')
      .find({
        created_at: { $gte: cooldownStart }
      })
      .toArray()

    if (recentTrades.length > 0) {
      console.log(`Found ${recentTrades.length} trades within cooldown period of ${COOLDOWN_HOURS} hours. Skipping new trades.`)
      return
    }
    
    // Instead of time-based query, get the two most recent records directly
    const recentResults = await db.collection('transactions_per_hour')
      .find({})
      .sort({ timestamp: -1 }) // descending order to get most recent first
      .limit(2)
      .toArray()

    // Sort back into ascending order for our logic
    recentResults.sort((a, b) => a.timestamp - b.timestamp)

    console.log('recent results:', recentResults)
    
    if (recentResults.length < 2) {
      console.log('Not enough analysis data to make trading decisions')
      return
    }
    
    // Check if most recent record was updated within last 30 minutes
    const mostRecentRecord = recentResults[1]
    const fifteenMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    if (mostRecentRecord.updated_at < fifteenMinutesAgo) {
      console.log('Most recent record is too old:', mostRecentRecord.updated_at)
      return
    }
    
    // Check for signal - two consecutive hours with counts over 20
    let signalDetected = false
    let signalHour = null
    
    for (let i = 1; i < recentResults.length; i++) {
      if (recentResults[i].count >= SIGNAL_THRESHOLD && 
          recentResults[i-1].count >= SIGNAL_THRESHOLD) {
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
    const orderResult = await placeOrder(direction, POSITION_SIZE, false) // ETH position with 4% trailing stop
    
    // Record the signal and order in the database
    await db.collection('trading_signals').insertOne({
      signal_hour: signalHour,
      created_at: new Date(),
      direction: direction,
      ema_data: indicators,
      market_order_id: orderResult?.marketOrder?.sendStatus?.order_id || null,
      market_order_status: orderResult?.marketOrder?.sendStatus?.status || 'failed',
      trailing_stop_order_id: orderResult?.trailingStopOrder?.sendStatus?.order_id || null,
      trailing_stop_status: orderResult?.trailingStopOrder?.sendStatus?.status || 'failed',
      result: orderResult?.marketOrder?.result || 'failed',
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