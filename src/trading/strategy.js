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
    
    // Check if most recent record was created within last 30 minutes
    const mostRecentRecord = recentResults[1]
    const fifteenMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    if (mostRecentRecord.created_at < fifteenMinutesAgo) {
      console.log('Most recent record is too old:', mostRecentRecord.created_at)
      return
    }
    
    // Check for signal - two consecutive hours with counts over 20
    const SIGNAL_THRESHOLD = 20
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

    // Get open positions
    /* const openPositionsResponse = await getOpenPositions()
    console.log('open positions:', openPositionsResponse)
    
    // Check if we have an open ETH position
    let existingEthPosition = null
    if (openPositionsResponse?.result === "success" && openPositionsResponse.openPositions) {
      existingEthPosition = openPositionsResponse.openPositions.find(
        position => position.symbol === "PF_ETHUSD"
      )
    }
    
    // Handle existing position
    if (existingEthPosition) {
      const currentPositionDirection = existingEthPosition.side === "long" ? "buy" : "sell"
      
      if (currentPositionDirection === direction) {
        console.log(`Already have a ${direction} position open for ETH, not placing new order`)
        return
      } else {
        console.log(`Closing existing ${currentPositionDirection} position before opening ${direction} position`)
        // Close the existing position - opposite of current position direction
        const closeDirection = currentPositionDirection === "buy" ? "sell" : "buy"
        const closeResult = await placeOrder(closeDirection, existingEthPosition.size, true)
        
        console.log(`Closed position result: ${JSON.stringify(closeResult)}`)
        
        // Wait a moment for the close to process
        await new Promise(resolve => setTimeout(resolve, 1000))
      }
    } */
    
    // Place order
    console.log(`Placing ${direction} order based on signal at ${signalHour.toISOString()}`)
    const orderResult = await placeOrder(direction, 0.1, false) // 0.1 ETH position size with 4% trailing stop
    
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