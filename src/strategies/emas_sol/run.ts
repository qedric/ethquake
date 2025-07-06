import { getEMAs } from '../../trading/indicators.js'
import { placeOrder, hasOpenPosition, replaceOrder } from '../../trading/kraken.js'
import { getDb, logActivity } from '../../lib/mongodb.js'
import { loadStrategyConfig } from '../../lib/loadConfig.js'

// Load configuration values from strategy.json
const config = loadStrategyConfig('strategies/emas_sol')

// Load configuration values
const EMA_FAST_LEN = config.indicators.ema_fast
const EMA_MID_1_LEN = config.indicators.ema_mid_1
const EMA_MID_2_LEN = config.indicators.ema_mid_2
const EMA_SLOW_LEN = config.indicators.ema_slow

const USE_TP = config.risk_management.take_profit.enabled
const TP_PCT = config.risk_management.take_profit.percentage
const USE_SL = config.risk_management.stop_loss.enabled
const SL_PCT = config.risk_management.stop_loss.percentage
const USE_TR = config.risk_management.trailing_stop.enabled
const TR_PCT = config.risk_management.trailing_stop.percentage

// trading config
const POSITION_SIZE = config.trading.position_size
const TRADING_PAIR = config.trading.symbol
const TIMEFRAME = config.trading.timeframe

// Database config
const DB_NAME = 'strategies'
const COLLECTION_NAME = 'strategy_state'

// State
let currentPosition: 'long' | 'short' | null = null
let entryPrice: number | null = null
let currentStopOrderId: string | null = null
let currentTakeProfitOrderId: string | null = null
let trailingStop: number | null = null

async function loadState() {
  const db = await getDb(DB_NAME)
  const st = await db.collection(COLLECTION_NAME).findOne({ 
    strategy: config.name,
    symbol: TRADING_PAIR 
  })
  
  if (st) {
    currentPosition = st.currentPosition
    entryPrice = st.entryPrice
    currentStopOrderId = st.currentStopOrderId
    currentTakeProfitOrderId = st.currentTakeProfitOrderId
    trailingStop = st.trailingStop

    console.log(`[${config.name}] State loaded:`, {
      currentPosition,
      entryPrice,
      currentStopOrderId,
      currentTakeProfitOrderId,
      trailingStop
    })
    
    // Verify position still exists
    if (currentPosition && !await hasOpenPosition(TRADING_PAIR)) {
      console.error(`[${config.name}] State reset: position not found`)
      currentPosition = null
      entryPrice = null
      currentStopOrderId = null
      currentTakeProfitOrderId = null
      trailingStop = null
      await logActivity(DB_NAME, {
        strategy: config.name,
        symbol: TRADING_PAIR,
        type: 'state_reset',
        reason: 'position_not_found'
      })
    }
  }
}

async function saveState() {
  const db = await getDb(DB_NAME)
  await db.collection(COLLECTION_NAME).updateOne(
    { 
      strategy: config.name,
      symbol: TRADING_PAIR 
    },
    { 
      $set: {
        strategy: config.name,
        symbol: TRADING_PAIR,
        currentPosition, 
        entryPrice, 
        currentStopOrderId,
        currentTakeProfitOrderId, 
        trailingStop,
        lastUpdated: new Date()
      } 
    }, 
    { upsert: true }
  )
  
  // Log state change
  await logActivity(DB_NAME, {
    strategy: config.name,
    symbol: TRADING_PAIR,
    type: 'state_update',
    state: {
      currentPosition,
      entryPrice,
      hasStopOrder: !!currentStopOrderId,
      hasTakeProfitOrder: !!currentTakeProfitOrderId,
      hasTrailingStop: !!trailingStop
    }
  })
}

export async function runPipelineTask() {
  try {
    await loadState()

    // Log initial state
    await logActivity(DB_NAME, {
      strategy: config.name,
      symbol: TRADING_PAIR,
      type: 'pipeline_start',
      state: {
        currentPosition,
        entryPrice,
        hasStopOrder: !!currentStopOrderId,
        hasTakeProfitOrder: !!currentTakeProfitOrderId
      }
    })

    // fetch latest EMAs
    let candles
    try {
      candles = await getEMAs(TRADING_PAIR, TIMEFRAME, [EMA_FAST_LEN, EMA_MID_1_LEN, EMA_MID_2_LEN, EMA_SLOW_LEN], 2)
    } catch (err: any) {
      console.error(`[${config.name}] Failed to get EMA data: ${err?.message || 'Unknown error'}`)
      return
    }

    if (!candles || candles.length < 2) {
      console.error(`[${config.name}] Insufficient candle data returned`)
      return
    }

    const prev = candles[candles.length - 2]
    const curr = candles[candles.length - 1]

    // Check if we have all required data
    if (!curr || !prev || !curr.price || 
        !curr[`ema${EMA_FAST_LEN}`] || !curr[`ema${EMA_MID_1_LEN}`] || 
        !curr[`ema${EMA_MID_2_LEN}`] || !curr[`ema${EMA_SLOW_LEN}`] ||
        !prev[`ema${EMA_FAST_LEN}`] || !prev[`ema${EMA_SLOW_LEN}`]) {
      console.error(`[${config.name}] Missing required EMA data:`, {
        curr: curr ? {
          timestamp: curr.timestamp,
          price: curr.price,
          [`ema${EMA_FAST_LEN}`]: curr[`ema${EMA_FAST_LEN}`],
          [`ema${EMA_MID_1_LEN}`]: curr[`ema${EMA_MID_1_LEN}`],
          [`ema${EMA_MID_2_LEN}`]: curr[`ema${EMA_MID_2_LEN}`],
          [`ema${EMA_SLOW_LEN}`]: curr[`ema${EMA_SLOW_LEN}`]
        } : 'missing',
        prev: prev ? {
          timestamp: prev.timestamp,
          price: prev.price,
          [`ema${EMA_FAST_LEN}`]: prev[`ema${EMA_FAST_LEN}`],
          [`ema${EMA_SLOW_LEN}`]: prev[`ema${EMA_SLOW_LEN}`]
        } : 'missing'
      })
      return
    }

    const emaFast = curr[`ema${EMA_FAST_LEN}`]
    const emaMid1 = curr[`ema${EMA_MID_1_LEN}`]
    const emaMid2 = curr[`ema${EMA_MID_2_LEN}`]
    const emaSlow = curr[`ema${EMA_SLOW_LEN}`]

    // Log successful EMA calculation for debugging
    console.log(`[${config.name}] EMAs calculated @ ${curr.price}:`, {
      timestamp: curr.timestamp,
      current: {
        [`ema${EMA_FAST_LEN}`]: emaFast.toFixed(2),
        [`ema${EMA_MID_1_LEN}`]: emaMid1.toFixed(2),
        [`ema${EMA_MID_2_LEN}`]: emaMid2.toFixed(2),
        [`ema${EMA_SLOW_LEN}`]: emaSlow.toFixed(2)
      },
      previous: {
        [`ema${EMA_FAST_LEN}`]: prev[`ema${EMA_FAST_LEN}`].toFixed(2),
        [`ema${EMA_SLOW_LEN}`]: prev[`ema${EMA_SLOW_LEN}`].toFixed(2)
      }
    })

    // entry signals - exactly matching Pine script conditions
    const longSignal = emaFast > emaSlow && emaFast > emaMid1 && emaFast > emaMid2
    const shortSignal = prev[`ema${EMA_FAST_LEN}`] >= prev[`ema${EMA_SLOW_LEN}`] && 
                       curr[`ema${EMA_FAST_LEN}`] < curr[`ema${EMA_SLOW_LEN}`] && 
                       emaFast < emaMid1 && emaFast < emaMid2

    // Log signal evaluation to DB
    await logActivity(DB_NAME, {
      strategy: config.name,
      symbol: TRADING_PAIR,
      type: 'signal_evaluation',
      data: {
        timestamp: curr.timestamp,
        price: curr.price,
        longSignal,
        shortSignal,
        conditions: {
          long: {
            ema_fast_above_slow: emaFast > emaSlow,
            ema_fast_above_mid1: emaFast > emaMid1,
            ema_fast_above_mid2: emaFast > emaMid2
          },
          short: {
            prev_ema_fast_above_slow: prev[`ema${EMA_FAST_LEN}`] >= prev[`ema${EMA_SLOW_LEN}`],
            curr_ema_fast_below_slow: curr[`ema${EMA_FAST_LEN}`] < curr[`ema${EMA_SLOW_LEN}`],
            ema_fast_below_mid1: emaFast < emaMid1,
            ema_fast_below_mid2: emaFast < emaMid2
          }
        }
      }
    })

    // compute exit prices
    let reCalculateExit = false
    let tpPriceLong: number | null = null
    let tpPriceShort: number | null = null
    let slPriceLong: number | null = null
    let slPriceShort: number | null = null

    const inLong = currentPosition === 'long'
    const inShort = currentPosition === 'short'

    // compute exit prices
    if (currentPosition && entryPrice !== null) {
      reCalculateExit = (inLong && longSignal) || (inShort && shortSignal)
      // If we get a signal in same direction as current position,
      // recalculate exits from current price to give trade more room
      const exitCalcPrice = reCalculateExit ? curr.price : entryPrice
      
      if (USE_TP) {
        tpPriceLong = exitCalcPrice * (1 + TP_PCT / 100)
        tpPriceShort = exitCalcPrice * (1 - TP_PCT / 100)
      }
      if (USE_SL) {
        slPriceLong = exitCalcPrice * (1 - SL_PCT / 100)
        slPriceShort = exitCalcPrice * (1 + SL_PCT / 100)
      }
      if (USE_TR) {
        // Update trailing stop to use percentage directly
        if (inLong) {
          trailingStop = trailingStop === null 
            ? curr.price * (1 - TR_PCT / 100)
            : Math.max(curr.high * (1 - TR_PCT / 100), trailingStop)
        } else if (inShort) {
          trailingStop = trailingStop === null
            ? curr.price * (1 + TR_PCT / 100)
            : Math.min(curr.low * (1 + TR_PCT / 100), trailingStop)
        }
      }

      // If we're recalculating exits, we need to replace the existing orders
      if (reCalculateExit) {
        const side = currentPosition === 'long' ? 'buy' : 'sell'
        console.log(`[${config.name}] Updating exits for ${currentPosition} position at ${curr.price}`)
        
        // Replace stop order if we have one
        if (currentStopOrderId && (USE_TR || USE_SL)) {
          const stopConfig = USE_TR
            ? { type: 'trailing' as const, distance: TR_PCT }
            : USE_SL
              ? { type: 'fixed' as const, distance: 0, stopPrice: currentPosition === 'long' ? slPriceLong! : slPriceShort! }
              : { type: 'none' as const, distance: 0 }

          const result = await replaceOrder(
            currentStopOrderId,
            side,
            POSITION_SIZE,
            stopConfig,
            { type: 'none', price: 0 },
            TRADING_PAIR,
            true // isStopOrder
          )
          if (result.success && result.newOrderId) {
            currentStopOrderId = result.newOrderId
            await saveState()
          }
        }

        // Replace take profit order if we have one
        if (currentTakeProfitOrderId && USE_TP) {
          const tpConfig = {
            type: 'limit' as const,
            price: currentPosition === 'long' ? tpPriceLong! : tpPriceShort!
          }
          
          const result = await replaceOrder(
            currentTakeProfitOrderId,
            side,
            POSITION_SIZE,
            { type: 'none', distance: 0 },
            tpConfig,
            TRADING_PAIR,
            false // isStopOrder
          )
          if (result.success && result.newOrderId) {
            currentTakeProfitOrderId = result.newOrderId
            await saveState()
          }
        }
      }
    } else {
      trailingStop = null
    }

    // ENTRY logic - exactly matching Pine script conditions
    if (longSignal) {
      if (inShort) {
        console.log(`[${config.name}] Closing short position at ${curr.price}`)
        await placeOrder('buy', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true)
        currentPosition = null
        currentStopOrderId = null
        currentTakeProfitOrderId = null
        trailingStop = null
      }
      if (!inLong) {
        console.log(`[${config.name}] Opening long position at ${curr.price}`)
        const slPriceLong = USE_SL ? curr.price * (1 - SL_PCT / 100) : null
        const tpPriceLong = USE_TP ? curr.price * (1 + TP_PCT / 100) : null

        const stopConfig = USE_TR
          ? { type: 'trailing' as const, distance: TR_PCT }
          : USE_SL
            ? { type: 'fixed' as const, distance: 0, stopPrice: slPriceLong! }
            : { type: 'none' as const, distance: 0 }

        const tpConfig = USE_TP && tpPriceLong !== null
          ? { type: 'limit' as const, price: tpPriceLong }
          : { type: 'none' as const, price: 0 }

        const result = await placeOrder('buy', POSITION_SIZE, stopConfig, tpConfig, TRADING_PAIR)
        currentPosition = 'long'
        entryPrice = curr.price
        currentStopOrderId = result.stopOrder?.sendStatus?.order_id || null
        currentTakeProfitOrderId = result.takeProfitOrder?.sendStatus?.order_id || null
        await saveState()
      }
    }

    if (shortSignal) {
      if (inLong) {
        console.log(`[${config.name}] Closing long position at ${curr.price}`)
        await placeOrder('sell', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true)
        currentPosition = null
        currentStopOrderId = null
        currentTakeProfitOrderId = null
        trailingStop = null
      }
      if (!inShort) {
        console.log(`[${config.name}] Opening short position at ${curr.price}`)
        const slPriceShort = USE_SL ? curr.price * (1 + SL_PCT / 100) : null
        const tpPriceShort = USE_TP ? curr.price * (1 - TP_PCT / 100) : null

        const stopConfig = USE_TR
          ? { type: 'trailing' as const, distance: TR_PCT }
          : USE_SL
            ? { type: 'fixed' as const, distance: 0, stopPrice: slPriceShort! }
            : { type: 'none' as const, distance: 0 }

        const tpConfig = USE_TP && tpPriceShort !== null
          ? { type: 'limit' as const, price: tpPriceShort }
          : { type: 'none' as const, price: 0 }

        const result = await placeOrder('sell', POSITION_SIZE, stopConfig, tpConfig, TRADING_PAIR)
        currentPosition = 'short'
        entryPrice = curr.price
        currentStopOrderId = result.stopOrder?.sendStatus?.order_id || null
        currentTakeProfitOrderId = result.takeProfitOrder?.sendStatus?.order_id || null
        await saveState()
      }
    }

    await saveState()
  } catch (err: any) {
    console.error(`[${config.name}] Pipeline error:`, err)
    await logActivity(DB_NAME, {
      strategy: config.name,
      symbol: TRADING_PAIR,
      type: 'error',
      error: err?.message || 'Unknown error'
    })
  }
}