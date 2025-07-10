import { getEMAs } from '../../trading/indicators.js'
import { placeOrder, hasOpenPosition, replaceOrder } from '../../trading/kraken.js'
import { getDb, logActivity } from '../../lib/mongodb.js'
import { loadStrategyConfig } from '../../lib/loadConfig.js'
import { syncPositionWithExchange } from '../../trading/positions.js'

// Load configuration values from strategy.json
const config = loadStrategyConfig('strategies/emas_btc')

const EMA_FAST = config.indicators.ema_fast
const EMA_MID_1 = config.indicators.ema_mid_1
const EMA_MID_2 = config.indicators.ema_mid_2
const EMA_SLOW = config.indicators.ema_slow

const USE_SENTIMENT = config.indicators.ema_sentiment?.enabled ?? false
const EMA_SENTIMENT = config.indicators.ema_sentiment?.length ?? 800

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
    
    // Verify position still exists
    if (currentPosition && !await hasOpenPosition(TRADING_PAIR)) {
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

  // Check and update position status first
  await syncPositionWithExchange(config.name, TRADING_PAIR)

  // fetch latest EMAs
  const candles = await getEMAs(TRADING_PAIR, TIMEFRAME, [EMA_FAST, EMA_MID_1, EMA_MID_2, EMA_SLOW], 2)
  const prev = candles[candles.length - 2]
  const curr = candles[candles.length - 1]

  const emaFast = curr[`ema${EMA_FAST}`]
  const emaMid1 = curr[`ema${EMA_MID_1}`]
  const emaMid2 = curr[`ema${EMA_MID_2}`]
  const emaSlow = curr[`ema${EMA_SLOW}`]

  // fetch latest sentiment reading (longterm EMA)
  const emaSentiment = USE_SENTIMENT ? await getEMAs(TRADING_PAIR, TIMEFRAME, [EMA_SENTIMENT], 1) : null

  // Log successful EMA calculation for debugging
  console.log(`[${config.name}] EMAs calculated @ ${curr.price}:`, {
    timestamp: curr.timestamp,
    current: {
      [`ema${EMA_FAST}`]: emaFast.toFixed(2),
      [`ema${EMA_MID_1}`]: emaMid1.toFixed(2),
      [`ema${EMA_MID_2}`]: emaMid2.toFixed(2),
      [`ema${EMA_SLOW}`]: emaSlow.toFixed(2),
      [`ema${EMA_SENTIMENT}`]: emaSentiment ? emaSentiment[0][`ema${EMA_SENTIMENT}`].toFixed(2) : 'N/A'
    },
    previous: {
      [`ema${EMA_FAST}`]: prev[`ema${EMA_FAST}`].toFixed(2),
      [`ema${EMA_SLOW}`]: prev[`ema${EMA_SLOW}`].toFixed(2)
    }
  })

  const sentimentIsLong = emaSentiment ? curr.price > emaSentiment[0][`ema${EMA_SENTIMENT}`] : true
  const sentimentIsShort = emaSentiment ? curr.price < emaSentiment[0][`ema${EMA_SENTIMENT}`] : true
  
  // entry signals - exactly matching Pine script conditions
  const longSignal = sentimentIsLong && emaFast > emaSlow && emaFast > emaMid1 && emaFast > emaMid2
  const shortSignal = sentimentIsShort && prev[`ema${EMA_FAST}`] >= prev[`ema${EMA_SLOW}`] && curr[`ema${EMA_FAST}`] < curr[`ema${EMA_SLOW}`] && emaFast < emaMid1 && emaFast < emaMid2

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
          sentiment_is_long: sentimentIsLong,
          ema_fast_above_slow: emaFast > emaSlow,
          ema_fast_above_mid1: emaFast > emaMid1,
          ema_fast_above_mid2: emaFast > emaMid2
        },
        short: {
          sentiment_is_short: sentimentIsShort,
          prev_ema_fast_above_slow: prev[`ema${EMA_FAST}`] >= prev[`ema${EMA_SLOW}`],
          curr_ema_fast_below_slow: curr[`ema${EMA_FAST}`] < curr[`ema${EMA_SLOW}`],
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
      if (currentStopOrderId && USE_SL) {
        const stopConfig = {
          type: 'fixed' as const,
          distance: 0,
          stopPrice: currentPosition === 'long' ? slPriceLong! : slPriceShort!
        }

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
      await placeOrder('buy', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true, config.name)
      currentPosition = null
      currentStopOrderId = null
      currentTakeProfitOrderId = null
      trailingStop = null
    }
    if (!inLong) {
      console.log(`[${config.name}] Opening long position at ${curr.price}`)
      const stopConfig = USE_TR
        ? { type: 'trailing' as const, distance: TR_PCT }
        : USE_SL
          ? { type: 'fixed' as const, distance: 0, stopPrice: slPriceLong! }
          : { type: 'none' as const, distance: 0 }

      const tpConfig = USE_TP && tpPriceLong !== null
        ? { type: 'limit' as const, price: tpPriceLong }
        : { type: 'none' as const, price: 0 }

      const result = await placeOrder('buy', POSITION_SIZE, stopConfig, tpConfig, TRADING_PAIR, false, config.name)
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
      await placeOrder('sell', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true, config.name)
      currentPosition = null
      currentStopOrderId = null
      currentTakeProfitOrderId = null
      trailingStop = null
    }
    if (!inShort) {
      console.log(`[${config.name}] Opening short position at ${curr.price}`)
      const stopConfig = USE_TR
        ? { type: 'trailing' as const, distance: TR_PCT }
        : USE_SL
          ? { type: 'fixed' as const, distance: 0, stopPrice: slPriceShort! }
          : { type: 'none' as const, distance: 0 }

      const tpConfig = USE_TP && tpPriceShort !== null
        ? { type: 'limit' as const, price: tpPriceShort }
        : { type: 'none' as const, price: 0 }

      const result = await placeOrder('sell', POSITION_SIZE, stopConfig, tpConfig, TRADING_PAIR, false, config.name)
      currentPosition = 'short'
      entryPrice = curr.price
      currentStopOrderId = result.stopOrder?.sendStatus?.order_id || null
      currentTakeProfitOrderId = result.takeProfitOrder?.sendStatus?.order_id || null
      await saveState()
    }
  }

  await saveState()
}