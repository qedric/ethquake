import { getEMAs, CandleData } from '../../trading/indicators.js'
import { placeOrder, replaceStopOrder, hasOpenPosition } from '../../trading/kraken.js'
import { getDb } from '../../lib/mongodb.js'

// Strategy parameters
const LOOKBACK_WINDOW = 18
const TRAILING_STOP_PERCENT = 6
const FREEZE_TRIGGER_PERCENT = 2
const LONG_ONLY = false
const POSITION_SIZE = 0.008 // Size in BTC 
const TRADING_PAIR = 'PF_XBTUSD'
const TIMEFRAME = 60 // 60 minutes = 1 hour
const DB_NAME = 'emas'

// State interface
interface StrategyState {
  crossedFastMid1History: boolean[]
  crossedFastMid2History: boolean[]
  crossedFastSlowHistory: boolean[]
  currentPosition: 'long' | 'short' | null
  entryPrice: number | null
  maxPrice: number | null
  frozenStop: number | null
  stopFrozen: boolean
  currentStopOrderId: string | null
  currentPositionId: string | null
  lastUpdated: Date
}

// State management
let crossedFastMid1History: boolean[] = []
let crossedFastMid2History: boolean[] = []
let crossedFastSlowHistory: boolean[] = []
let currentPosition: 'long' | 'short' | null = null
let entryPrice: number | null = null
let maxPrice: number | null = null
let frozenStop: number | null = null
let stopFrozen = false
let currentStopOrderId: string | null = null
let currentPositionId: string | null = null

async function loadState(): Promise<void> {
  try {
    const db = await getDb(DB_NAME)
    const state = await db.collection('strategy_state').findOne({})
    
    if (state) {
      crossedFastMid1History = state.crossedFastMid1History
      crossedFastMid2History = state.crossedFastMid2History
      crossedFastSlowHistory = state.crossedFastSlowHistory
      currentPosition = state.currentPosition
      currentPositionId = state.currentPositionId
      entryPrice = state.entryPrice
      maxPrice = state.maxPrice
      frozenStop = state.frozenStop
      stopFrozen = state.stopFrozen
      currentStopOrderId = state.currentStopOrderId
      
      // Verify position state matches exchange
      if (currentPosition) {
        const hasPosition = await hasOpenPosition(TRADING_PAIR)
        if (!hasPosition) {
          console.log('[Strategy: emas] Stored position state does not match exchange - resetting state')
          resetState()
        }
      }
    }
  } catch (error) {
    console.error('[Strategy: emas] Error loading strategy state:', error)
    // Continue with default state
  }
}

async function saveState(): Promise<void> {
  try {
    const db = await getDb(DB_NAME)
    const state: StrategyState = {
      crossedFastMid1History,
      crossedFastMid2History,
      crossedFastSlowHistory,
      currentPosition,
      currentPositionId,
      entryPrice,
      maxPrice,
      frozenStop,
      stopFrozen,
      currentStopOrderId,
      lastUpdated: new Date()
    }
    
    await db.collection('strategy_state').replaceOne({}, state, { upsert: true })
  } catch (error) {
    console.error('[Strategy: emas] Error saving strategy state:', error)
  }
}

function resetState(): void {
  crossedFastMid1History = []
  crossedFastMid2History = []
  crossedFastSlowHistory = []
  currentPosition = null
  currentPositionId = null
  entryPrice = null
  maxPrice = null
  frozenStop = null
  stopFrozen = false
  currentStopOrderId = null
}

// EMA periods
const EMA_PERIODS = [20, 44, 80, 190] // Fast, Mid1, Mid2, Slow

// Stop configurations
const TRAILING_STOP = { type: 'trailing' as const, distance: TRAILING_STOP_PERCENT }
const FIXED_STOP = (price: number) => ({ 
  type: 'fixed' as const, 
  distance: TRAILING_STOP_PERCENT,
  stopPrice: price 
})
const NO_STOP = { type: 'none' as const, distance: 0 }

function hasCrossedRecently(history: boolean[]): boolean {
  return history.some(crossed => crossed)
}

function detectCross(current: CandleData, previous: CandleData): {
  fastMid1Cross: { crossover: boolean, crossunder: boolean }
  fastMid2Cross: { crossover: boolean, crossunder: boolean }
  fastSlowCross: { crossover: boolean, crossunder: boolean }
} {
  return {
    fastMid1Cross: {
      crossover: previous.ema20 <= previous.ema44 && current.ema20 > current.ema44,
      crossunder: previous.ema20 >= previous.ema44 && current.ema20 < current.ema44
    },
    fastMid2Cross: {
      crossover: previous.ema20 <= previous.ema80 && current.ema20 > current.ema80,
      crossunder: previous.ema20 >= previous.ema80 && current.ema20 < current.ema80
    },
    fastSlowCross: {
      crossover: previous.ema20 <= previous.ema190 && current.ema20 > current.ema190,
      crossunder: previous.ema20 >= previous.ema190 && current.ema20 < current.ema190
    }
  }
}

export async function runPipelineTask() {
  try {
    // Load state at the start of each run
    await loadState()

    // Get enough historical candles to cover our lookback window
    const candles = await getEMAs('BTCUSD', TIMEFRAME, EMA_PERIODS, LOOKBACK_WINDOW + 1)
    
    // Most recent candle is the current one
    const currentCandle = candles[candles.length - 1]

    // Process all historical crosses
    for (let i = 1; i < candles.length; i++) {
      const crosses = detectCross(candles[i], candles[i - 1])
      const { fastMid1Cross, fastMid2Cross, fastSlowCross } = crosses

      // Update cross history
      if (fastMid1Cross.crossover || fastMid1Cross.crossunder) {
        crossedFastMid1History.unshift(true)
      } else {
        crossedFastMid1History.unshift(false)
      }

      if (fastMid2Cross.crossover || fastMid2Cross.crossunder) {
        crossedFastMid2History.unshift(true)
      } else {
        crossedFastMid2History.unshift(false)
      }

      if (fastSlowCross.crossover || fastSlowCross.crossunder) {
        crossedFastSlowHistory.unshift(true)
      } else {
        crossedFastSlowHistory.unshift(false)
      }
    }

    // Maintain history length
    crossedFastMid1History = crossedFastMid1History.slice(0, LOOKBACK_WINDOW)
    crossedFastMid2History = crossedFastMid2History.slice(0, LOOKBACK_WINDOW)
    crossedFastSlowHistory = crossedFastSlowHistory.slice(0, LOOKBACK_WINDOW)

    // Get the most recent crosses
    const latestCrosses = detectCross(currentCandle, candles[candles.length - 2])
    const { fastMid1Cross, fastMid2Cross, fastSlowCross } = latestCrosses

    // Rest of the trading logic remains the same...
    const hasRecentMid1Cross = hasCrossedRecently(crossedFastMid1History)
    const hasRecentMid2Cross = hasCrossedRecently(crossedFastMid2History)
    const hasRecentSlowCross = hasCrossedRecently(crossedFastSlowHistory)

    // Entry logic - need crosses with all three longer EMAs
    const hasAllBullishCrosses = 
      (fastMid1Cross.crossover && hasRecentMid2Cross && hasRecentSlowCross) ||
      (fastMid2Cross.crossover && hasRecentMid1Cross && hasRecentSlowCross) ||
      (fastSlowCross.crossover && hasRecentMid1Cross && hasRecentMid2Cross)

    const hasAllBearishCrosses = 
      (fastMid1Cross.crossunder && hasRecentMid2Cross && hasRecentSlowCross) ||
      (fastMid2Cross.crossunder && hasRecentMid1Cross && hasRecentSlowCross) ||
      (fastSlowCross.crossunder && hasRecentMid1Cross && hasRecentMid2Cross)

    // Bullish signal: close any shorts and enter long
    if (hasAllBullishCrosses) {
      if (currentPosition === 'short') {
        await placeOrder('buy', POSITION_SIZE, NO_STOP, TRADING_PAIR, true) // Close short with market, reduceOnly
        currentPosition = null
        currentPositionId = null
      }
      if (currentPosition !== 'long') {
        const orderResult = await placeOrder('buy', POSITION_SIZE, TRAILING_STOP, TRADING_PAIR) // Enter long with trailing stop
        if (orderResult.marketOrder?.sendStatus?.positionId) {
          currentPositionId = orderResult.marketOrder.sendStatus.positionId
        }
        if (orderResult.stopOrder?.sendStatus?.order_id) {
          currentStopOrderId = orderResult.stopOrder.sendStatus.order_id
        }
        entryPrice = currentCandle.price
        maxPrice = currentCandle.price
        frozenStop = null
        stopFrozen = false
        currentPosition = 'long'

        // Record the trade in trading_signals collection
        const db = await getDb(DB_NAME)
        await db.collection('trading_signals').insertOne({
          created_at: new Date(),
          direction: 'buy',
          ema_data: currentCandle,
          market_order_id: orderResult?.marketOrder?.sendStatus?.order_id || null,
          market_order_status: orderResult?.marketOrder?.sendStatus?.status || 'failed',
          stop_order_id: orderResult?.stopOrder?.sendStatus?.order_id || null,
          stop_status: orderResult?.stopOrder?.sendStatus?.status || 'failed',
          result: orderResult?.marketOrder?.result || 'failed',
          error: orderResult?.error || null,
          position_id: currentPositionId,
          entry_price: entryPrice
        })

        await saveState() // Save state after position entry
      }
    }

    // Bearish signal: always close longs, only enter short if allowed
    if (hasAllBearishCrosses) {
      if (currentPosition === 'long') {
        await placeOrder('sell', POSITION_SIZE, NO_STOP, TRADING_PAIR, true) // Close long with market, reduceOnly
        currentPosition = null
        currentPositionId = null
      }
      // Only enter short if shorts are allowed
      if (!LONG_ONLY && currentPosition !== 'short') {
        const orderResult = await placeOrder('sell', POSITION_SIZE, TRAILING_STOP, TRADING_PAIR) // Enter short with trailing stop
        if (orderResult.marketOrder?.sendStatus?.positionId) {
          currentPositionId = orderResult.marketOrder.sendStatus.positionId
        }
        if (orderResult.stopOrder?.sendStatus?.order_id) {
          currentStopOrderId = orderResult.stopOrder.sendStatus.order_id
        }
        entryPrice = currentCandle.price
        maxPrice = currentCandle.price
        frozenStop = null
        stopFrozen = false
        currentPosition = 'short'

        // Record the trade in trading_signals collection
        const db = await getDb(DB_NAME)
        await db.collection('trading_signals').insertOne({
          created_at: new Date(),
          direction: 'sell',
          ema_data: currentCandle,
          market_order_id: orderResult?.marketOrder?.sendStatus?.order_id || null,
          market_order_status: orderResult?.marketOrder?.sendStatus?.status || 'failed',
          stop_order_id: orderResult?.stopOrder?.sendStatus?.order_id || null,
          stop_status: orderResult?.stopOrder?.sendStatus?.status || 'failed',
          result: orderResult?.marketOrder?.result || 'failed',
          error: orderResult?.error || null,
          position_id: currentPositionId,
          entry_price: entryPrice
        })

        await saveState() // Save state after position entry
      }
    }

    // Trailing stop logic - now with safe replacement
    if (currentPosition === 'long' && entryPrice !== null && maxPrice !== null) {
      maxPrice = Math.max(maxPrice, currentCandle.price)
      const trailStop = maxPrice - (TRAILING_STOP_PERCENT / 100) * entryPrice
      const freezeLevel = entryPrice * (1 + FREEZE_TRIGGER_PERCENT / 100)

      // If we hit the freeze level, safely replace trailing stop with fixed stop
      if (!stopFrozen && maxPrice >= freezeLevel && currentStopOrderId) {
        console.log(`[Strategy: emas] Price ${maxPrice} hit freeze level ${freezeLevel}, freezing stop at ${trailStop}`)
        
        const replaceResult = await replaceStopOrder(
          currentStopOrderId,
          'sell',
          POSITION_SIZE,
          FIXED_STOP(trailStop),
          TRADING_PAIR
        )

        if (replaceResult.success && replaceResult.newOrderId) {
          currentStopOrderId = replaceResult.newOrderId
          frozenStop = trailStop
          stopFrozen = true
          console.log(`[Strategy: emas] Successfully froze stop at ${trailStop}`)
        } else {
          console.error('[Strategy: emas] Failed to freeze stop - keeping trailing stop active')
        }
      }

      // Check if our stop should have been hit
      if (currentCandle.price <= (stopFrozen ? frozenStop! : trailStop)) {
        // Verify if we still have a position before sending a market order
        const stillHavePosition = await hasOpenPosition(TRADING_PAIR)
        if (stillHavePosition) {
          console.log('[Strategy: emas] Stop level breached but position still open - sending market order to close')
          await placeOrder('sell', POSITION_SIZE, NO_STOP, TRADING_PAIR, true) // Close with market, reduceOnly
        } else {
          console.log('[Strategy: emas] Stop level breached but position already closed - skipping market order')
        }
        currentPosition = null
        currentPositionId = null
        entryPrice = null
        maxPrice = null
        frozenStop = null
        stopFrozen = false
        currentStopOrderId = null
        await saveState() // Save state after position exit
      }
    }

    if (currentPosition === 'short' && entryPrice !== null && maxPrice !== null) {
      maxPrice = Math.min(maxPrice, currentCandle.price)
      const trailStop = maxPrice + (TRAILING_STOP_PERCENT / 100) * entryPrice
      const freezeLevel = entryPrice * (1 - FREEZE_TRIGGER_PERCENT / 100)

      // If we hit the freeze level, safely replace trailing stop with fixed stop
      if (!stopFrozen && maxPrice <= freezeLevel && currentStopOrderId) {
        console.log(`[Strategy: emas] Price ${maxPrice} hit freeze level ${freezeLevel}, freezing stop at ${trailStop}`)
        
        const replaceResult = await replaceStopOrder(
          currentStopOrderId,
          'buy',
          POSITION_SIZE,
          FIXED_STOP(trailStop),
          TRADING_PAIR
        )

        if (replaceResult.success && replaceResult.newOrderId) {
          currentStopOrderId = replaceResult.newOrderId
          frozenStop = trailStop
          stopFrozen = true
          console.log(`[Strategy: emas] Successfully froze stop at ${trailStop}`)
        } else {
          console.error('[Strategy: emas] Failed to freeze stop - keeping trailing stop active')
        }
      }

      // Check if our stop should have been hit
      if (currentCandle.price >= (stopFrozen ? frozenStop! : trailStop)) {
        // Verify if we still have a position before sending a market order
        const stillHavePosition = await hasOpenPosition(TRADING_PAIR)
        if (stillHavePosition) {
          console.log('[Strategy: emas] Stop level breached but position still open - sending market order to close')
          await placeOrder('buy', POSITION_SIZE, NO_STOP, TRADING_PAIR, true) // Close with market, reduceOnly
        } else {
          console.log('[Strategy: emas] Stop level breached but position already closed - skipping market order')
        }
        currentPosition = null
        currentPositionId = null
        entryPrice = null
        maxPrice = null
        frozenStop = null
        stopFrozen = false
        currentStopOrderId = null
        await saveState() // Save state after position exit
      }
    }

    // Save state after each significant change
    await saveState()

  } catch (error) {
    console.error('[Strategy: emas] Error in EMA strategy:', error)
    throw error
  }
}
