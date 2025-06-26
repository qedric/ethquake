import { getEMAs, CandleData } from '../../trading/indicators.js'
import { placeOrder, replaceStopOrder, hasOpenPosition } from '../../trading/kraken.js'
import { getDb } from '../../lib/mongodb.js'

// ——--- USER INPUTS ---——
const EMA_FAST_LEN = 20
const EMA_50_LEN = 44
const EMA_100_LEN = 100
const EMA_200_LEN = 200

const USE_TP = true
const TP_PCT = 3.0
const USE_SL = false
const SL_PCT = 1.0
const USE_TR = false
const TR_PCT = 1.0

// trading config
const POSITION_SIZE = 0.01  // BTC
const TRADING_PAIR = 'PF_XBTUSD'
const TIMEFRAME = 60         // minutes

// State
let currentPosition: 'long' | 'short' | null = null
let entryPrice: number | null = null
let currentStopOrderId: string | null = null
let trailingStop: number | null = null

async function loadState() {
  const db = await getDb('emas')
  const st = await db.collection('strategy_state').findOne({})
  if (st) {
    currentPosition = st.currentPosition
    entryPrice = st.entryPrice
    currentStopOrderId = st.currentStopOrderId
    trailingStop = st.trailingStop
    if (currentPosition && ! await hasOpenPosition(TRADING_PAIR)) {
      currentPosition = null
      entryPrice = null
      currentStopOrderId = null
      trailingStop = null
    }
  }
}

async function saveState() {
  const db = await getDb('emas')
  await db.collection('strategy_state')
    .replaceOne({}, { currentPosition, entryPrice, currentStopOrderId, trailingStop }, { upsert: true })
}

export async function runPipelineTask() {
  await loadState()

  // fetch latest EMAs
  const candles = await getEMAs('BTCUSD', TIMEFRAME, [EMA_FAST_LEN, EMA_50_LEN, EMA_100_LEN, EMA_200_LEN], 2)
  const prev = candles[candles.length - 2]
  const curr = candles[candles.length - 1]

  const ema20 = curr.ema20
  const ema50 = curr.ema50
  const ema100 = curr.ema100
  const ema200 = curr.ema200

  // entry signals - exactly matching Pine script conditions
  const longSignal = ema20 > ema200 && ema20 > ema50 && ema20 > ema100
  const shortSignal = prev.ema20 >= prev.ema200 && curr.ema20 < curr.ema200 && ema20 < ema50 && ema20 < ema100

  // compute exit prices
  let tpPriceLong: number | null = null
  let tpPriceShort: number | null = null
  let slPriceLong: number | null = null
  let slPriceShort: number | null = null
  let trOffset: number | null = null

  const inLong = currentPosition === 'long'
  const inShort = currentPosition === 'short'

  if (currentPosition && entryPrice !== null) {
    if (USE_TP) {
      tpPriceLong = entryPrice * (1 + TP_PCT / 100)
      tpPriceShort = entryPrice * (1 - TP_PCT / 100)
    }
    if (USE_SL) {
      slPriceLong = entryPrice * (1 - SL_PCT / 100)
      slPriceShort = entryPrice * (1 + SL_PCT / 100)
    }
    if (USE_TR) {
      // Update trailing stop logic to match Pine script
      trOffset = TR_PCT / 100 * curr.price
      if (inLong) {
        trailingStop = trailingStop === null 
          ? curr.price - trOffset 
          : Math.max(curr.high - trOffset, trailingStop)
      } else if (inShort) {
        trailingStop = trailingStop === null
          ? curr.price + trOffset
          : Math.min(curr.low + trOffset, trailingStop)
      }
    }
  } else {
    trailingStop = null
  }

  // ENTRY logic - exactly matching Pine script conditions
  if (longSignal) {
    if (inShort) {
      await placeOrder('buy', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true)
      currentPosition = null
      trailingStop = null
    }
    if (!inLong) {
      const stopConfig = USE_TR
        ? { type: 'trailing' as const, distance: trOffset! }
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
      await saveState()
    }
  }

  if (shortSignal) {
    if (inLong) {
      await placeOrder('sell', POSITION_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TRADING_PAIR, true)
      currentPosition = null
      trailingStop = null
    }
    if (!inShort) {
      const stopConfig = USE_TR
        ? { type: 'trailing' as const, distance: trOffset! }
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
      await saveState()
    }
  }

  await saveState()
}