import { getDb } from '../../lib/mongodb.js'
import { placeOrder, getCurrentPrice } from '../../trading/kraken.js'
import { getEMAs } from '../../trading/indicators.js'
import { sendAlert } from '../../alerts/index.js'

const COOLDOWN_HOURS = 48 // no new trades within this time period
const SIGNAL_THRESHOLD = 40 // two consecutive hours with with a sum of counts exceeding this threshold
const ALERT_THRESHOLD = 40 // if the most recent hour has a count exceeding this threshold, send an alert
const POSITION_SIZE = 2
const TRADING_PAIR = 'PF_ETHUSD'
const STOP_CONFIG = { type: 'trailing' as const, distance: 4 } // 4% trailing stop

// Constants
const DB_NAME = process.env.MONGO_DB_NAME || 'ethquake'
const MAX_CONNECTION_ATTEMPTS = 3
const CONNECTION_RETRY_DELAY = 1000 // 1 second between connection attempts

/**
 * Executes the trading strategy based on:
 * 1. Ethquake signals (address activity spikes)
 * 2. Technical indicators (EMAs)
 * 
 * Strategy:
 * - Enter when there are two consecutive hours with counts over 20
 * - Use EMAs (20, 50, 100) to determine direction
 */
export async function executeTradeStrategy() {
  try {
    // First try to get the database
    let db = null
    let connectionAttempts = 0
    
    while (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      try {
        connectionAttempts++
        // getDb will handle the connection internally
        db = await getDb(DB_NAME)
        break // If we get here, connection succeeded
      } catch (error) {
        console.log(`[Strategy: ethquake] Database connection attempt ${connectionAttempts} failed - ${error instanceof Error ? error.message : String(error)}`)
        if (connectionAttempts === MAX_CONNECTION_ATTEMPTS) {
          throw new Error('Max connection attempts reached')
        }
        // Wait before retrying
        await new Promise(resolve => setTimeout(resolve, CONNECTION_RETRY_DELAY))
      }
    }

    if (!db) {
      throw new Error('Failed to connect to database')
    }
    
    // Instead of time-based query, get the two most recent records directly
    const recentResults = await db.collection('transactions_per_hour')
      .find({})
      .sort({ timestamp: -1 }) // descending order to get most recent first
      .limit(2)
      .toArray()

    // Sort back into ascending order for our logic
    recentResults.sort((a: any, b: any) => a.timestamp - b.timestamp)

    console.log('[Strategy: ethquake] recent results:', recentResults)
    
    if (recentResults.length < 2) {
      console.log('[Strategy: ethquake] Not enough analysis data to make trading decisions')
      return
    }
    
    // Check if most recent record was updated within last 30 minutes
    const mostRecentRecord = recentResults[1]
    const fifteenMinutesAgo = new Date(Date.now() - 30 * 60 * 1000)

    if (mostRecentRecord.updated_at < fifteenMinutesAgo) {
      console.log('[Strategy: ethquake] Most recent record is too old:', mostRecentRecord.updated_at)
      return
    }
    
    // Check for signal - two consecutive hours with counts over 20
    let signalDetected = false
    let signalHour = null
    
    for (let i = 1; i < recentResults.length; i++) {
      if ((recentResults[i].count + recentResults[i-1].count) >= SIGNAL_THRESHOLD) {
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
    const [indicators] = await getEMAs('ETHUSD', 15, [20, 50, 100]) // Get just current candle
    const { price, ema20, ema50, ema100 } = indicators
    
    // Determine trade direction based on EMAs
    type Direction = 'buy' | 'sell' | 'none'
    let direction: Direction = 'none'

    console.log('[Strategy: ethquake] current price:', price)
    console.log('[Strategy: ethquake] ema20:', ema20)
    console.log('[Strategy: ethquake] ema50:', ema50)
    console.log('[Strategy: ethquake] ema100:', ema100)
    
    // New direction logic using price and three EMAs
    if (price > ema20 && ema20 > ema50 && ema50 > ema100) {
      direction = 'buy'
    } else if (price < ema20 && ema20 < ema50 && ema50 < ema100) {
      direction = 'sell'
    }

    // Check for threshold breach and alert regardless other conditions
    if (recentResults[recentResults.length-1].count >= ALERT_THRESHOLD) {
      console.log(`[Strategy: ethquake] Alert threshold triggered: ${recentResults[recentResults.length-1].count} - Direction: ${direction}`)
      sendAlert(`Alert threshold triggered: ${recentResults[recentResults.length-1].count} - Direction: ${direction}`)
    }
    
    if (direction === 'none') {
      console.log('[Strategy: ethquake] No clear direction from technical indicators, not trading')
      sendAlert('Signal detected - no clear direction - not trading.')
      return
    }

     // Check for any trades within cooldown period
     const cooldownStart = new Date(Date.now() - (COOLDOWN_HOURS * 60 * 60 * 1000))
     const recentTrades = await db.collection('trading_signals')
       .find({
         created_at: { $gte: cooldownStart }
       })
       .toArray()
    

    if (recentTrades.length > 0) {
      console.log(`[Strategy: ethquake] Found ${recentTrades.length} trades within cooldown period of ${COOLDOWN_HOURS} hours. Skipping new trades.`)
      sendAlert(`Signal detected - within cooldown period - would have taken ${direction} position`)
      return
    }

    // Place order with trailing stop
    let orderResult = null
    let fixedStopResult = null
    if (direction === 'buy' || direction === 'sell') {
      console.log(`[Strategy: ethquake] Placing ${direction} order based on signal at ${signalHour.toISOString()}`)
      orderResult = await placeOrder(direction, POSITION_SIZE, STOP_CONFIG, { type: 'none', price: 0 }, TRADING_PAIR, false, 'ethquake')
      
      // If the initial order was successful, place an additional fixed stop loss
      if (orderResult?.marketOrder?.result === 'success' && orderResult?.marketOrder?.sendStatus?.order_id) {
        console.log(`[Strategy: ethquake] Initial order successful, placing additional 2% fixed stop loss`)
        
        try {
          // Calculate the fixed stop price based on direction and current price
          const currentPrice = await getCurrentPrice(TRADING_PAIR)
          const stopDistance = 0.02 // 2%
          const fixedStopPrice = direction === 'buy' 
            ? currentPrice * (1 - stopDistance) // For buy orders, stop below current price
            : currentPrice * (1 + stopDistance) // For sell orders, stop above current price
          
          const fixedStopConfig = { 
            type: 'fixed' as const, 
            distance: 2, 
            stopPrice: fixedStopPrice 
          }
          
          // Place the fixed stop loss order
          fixedStopResult = await placeOrder(
            direction === 'buy' ? 'sell' : 'buy', // Opposite side for stop loss
            POSITION_SIZE,
            fixedStopConfig,
            { type: 'none', price: 0 },
            TRADING_PAIR,
            true, // reduceOnly = true for stop loss
            'ethquake'
          )
          
          if (fixedStopResult?.stopOrder?.result === 'success') {
            console.log(`[Strategy: ethquake] Fixed stop loss placed successfully at ${fixedStopPrice}`)
          } else {
            console.error(`[Strategy: ethquake] Failed to place fixed stop loss:`, fixedStopResult?.error)
          }
        } catch (fixedStopError) {
          console.error(`[Strategy: ethquake] Error placing fixed stop loss:`, fixedStopError)
        }
      }
    }

    // Record the signal and order in the database
    await db.collection('trading_signals').insertOne({
      signal_hour: signalHour,
      created_at: new Date(),
      direction: direction,
      ema_data: indicators,
      market_order_id: orderResult?.marketOrder?.sendStatus?.order_id || null,
      market_order_status: orderResult?.marketOrder?.sendStatus?.status || 'failed',
      stop_order_id: orderResult?.stopOrder?.sendStatus?.order_id || null,
      stop_status: orderResult?.stopOrder?.sendStatus?.status || 'failed',
      fixed_stop_order_id: fixedStopResult?.stopOrder?.sendStatus?.order_id || null,
      fixed_stop_status: fixedStopResult?.stopOrder?.sendStatus?.status || 'failed',
      result: orderResult?.marketOrder?.result || 'failed',
      error: orderResult?.error || null
    })

    const fixedStopInfo = fixedStopResult?.stopOrder?.result === 'success' 
      ? `\nFixed Stop Loss: ${fixedStopResult.stopOrder.sendStatus.status}` 
      : '\nFixed Stop Loss: failed'
    
    sendAlert(`Signal detected - Entered ${direction} order based on signal at ${signalHour.toISOString()}\nOrder Result: ${orderResult?.marketOrder?.result || 'failed'}\nTrailing Stop Order Result: ${orderResult?.stopOrder?.sendStatus?.status || 'failed'}${fixedStopInfo}`)
    
    return {
      signalHour,
      direction,
      orderResult,
      fixedStopResult
    }
    
  } catch (error) {
    console.error('[Strategy: ethquake] Error executing trading strategy:', error)
    throw error
  }
} 