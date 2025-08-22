import { getDb } from '../../lib/mongodb.js'
import { placeOrderWithExits, getCurrentPrice, calculatePositionSize, placeStandaloneOrder, roundPrice, getPricePrecision } from '../../trading/kraken.js'
import { getEMAs } from '../../trading/indicators.js'
import { sendAlert } from '../../alerts/index.js'

const COOLDOWN_HOURS = 48
const POSITION_SIZE = 2
const POSITION_SIZE_PRECISION = 3
const TRADING_PAIR = 'PF_ETHUSD'
const FIXED_STOP_DISTANCE = 2
const TRAILING_STOP_DISTANCE = 4
const POSITION_SIZE_TYPE = 'risk'

// Dynamic threshold config
const DYN_LOOKBACK_DAYS = parseInt(process.env.ETHQUAKE_DYN_LOOKBACK_DAYS || '90')
const DYN_SIGNAL_PERCENTILE = parseFloat(process.env.ETHQUAKE_DYN_PERCENTILE || '0.95')
const DYN_ALERT_PERCENTILE = parseFloat(process.env.ETHQUAKE_ALERT_PERCENTILE || '0.975')

const DB_NAME = process.env.MONGO_DB_NAME || 'ethquake'
const MAX_CONNECTION_ATTEMPTS = 3
const CONNECTION_RETRY_DELAY = 1000

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const arr = [...values].sort((a, b) => a - b)
  const idx = Math.min(arr.length - 1, Math.max(0, Math.floor(p * (arr.length - 1))))
  return arr[idx]
}

async function computeDynamicThresholds(db: any) {
  const since = new Date(Date.now() - DYN_LOOKBACK_DAYS * 24 * 3600 * 1000)
  const rows = await db.collection('transactions_per_hour')
    .find({ timestamp: { $gte: since } })
    .sort({ timestamp: 1 })
    .project({ count: 1, timestamp: 1 })
    .toArray()

  const counts = rows.map((r: any) => r.count as number)
  const sums2h: number[] = []
  for (let i = 1; i < counts.length; i++) sums2h.push(counts[i] + counts[i - 1])

  const signalThreshold = percentile(sums2h, DYN_SIGNAL_PERCENTILE)
  const alertThreshold = percentile(counts, DYN_ALERT_PERCENTILE)

  return { signalThreshold, alertThreshold, rows }
}

export async function executeTradeStrategy() {
  try {
    let db = null
    let connectionAttempts = 0

    while (connectionAttempts < MAX_CONNECTION_ATTEMPTS) {
      try {
        connectionAttempts++
        db = await getDb(DB_NAME)
        break
      } catch (error) {
        console.log(`[Strategy: ethquake] Database connection attempt ${connectionAttempts} failed - ${error instanceof Error ? error.message : String(error)}`)
        if (connectionAttempts === MAX_CONNECTION_ATTEMPTS) throw new Error('Max connection attempts reached')
        await new Promise(resolve => setTimeout(resolve, CONNECTION_RETRY_DELAY))
      }
    }

    if (!db) throw new Error('Failed to connect to database')

    // Load dynamic thresholds
    const { signalThreshold, alertThreshold } = await computeDynamicThresholds(db)

    // Get last two hourly records for decision
    const recentResults = await db.collection('transactions_per_hour')
      .find({})
      .sort({ timestamp: -1 })
      .limit(2)
      .toArray()

    recentResults.sort((a: any, b: any) => a.timestamp - b.timestamp)

    if (recentResults.length < 2) {
      console.log('[Strategy: ethquake] Not enough analysis data to make trading decisions')
      return
    }

    const mostRecentRecord = recentResults[1]
    const now = new Date()
    const currentHourUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours()))
    const previousHourUTC = new Date(currentHourUTC.getTime() - 60 * 60 * 1000)

    if (mostRecentRecord.timestamp < previousHourUTC) {
      console.log('[Strategy: ethquake] Most recent record is too old:', mostRecentRecord.timestamp)
      console.log('[Strategy: ethquake] This suggests the data collection may not be working properly')
      return
    }

    // Dynamic two-hour sum signal
    const sum2h = recentResults[0].count + recentResults[1].count
    let signalDetected = sum2h >= signalThreshold
    let signalHour = recentResults[1].timestamp

    if (!signalDetected) {
      console.log(`[Strategy: ethquake] No signal: sum2h=${sum2h}, dyn_threshold=${signalThreshold}`)
      return recentResults
    }

    console.log(`Signal detected at ${signalHour.toISOString()} sum2h=${sum2h} dyn_threshold=${signalThreshold}`)

    // EMA direction
    const [indicators] = await getEMAs('ETHUSD', 15, [20, 50, 100])
    const { price, ema20, ema50, ema100 } = indicators

    type Direction = 'buy' | 'sell' | 'none'
    let direction: Direction = 'none'

    if (price > ema20 && ema20 > ema50 && ema50 > ema100) direction = 'buy'
    else if (price < ema20 && ema20 < ema50 && ema50 < ema100) direction = 'sell'

    // Dynamic alert on last hour
    const lastHourCount = recentResults[1].count
    if (lastHourCount >= alertThreshold) {
      console.log(`[Strategy: ethquake] Alert threshold triggered: ${lastHourCount} (dyn_alert=${alertThreshold}) - Direction: ${direction}`)
      sendAlert(`Alert threshold triggered: ${lastHourCount} (dyn_alert=${alertThreshold}) - Direction: ${direction}`)
    }

    if (direction === 'none') {
      console.log('[Strategy: ethquake] No clear direction from technical indicators, not trading')
      sendAlert('Signal detected - no clear direction - not trading.')
      return
    }

    const cooldownStart = new Date(Date.now() - (COOLDOWN_HOURS * 60 * 60 * 1000))
    const recentTrades = await db.collection('trading_signals')
      .find({ created_at: { $gte: cooldownStart } })
      .toArray()

    if (recentTrades.length > 0) {
      console.log(`[Strategy: ethquake] Found ${recentTrades.length} trades within cooldown period of ${COOLDOWN_HOURS} hours. Skipping new trades.`)
      sendAlert(`Signal detected - within cooldown period - would have taken ${direction} position`)
      return
    }

    let orderResult = null
    let trailingStopResult = null
    if (direction === 'buy' || direction === 'sell') {
      console.log(`[Strategy: ethquake] Placing ${direction} order based on signal at ${signalHour.toISOString()} (sum2h=${sum2h} dyn=${signalThreshold})`)

      const calculatedPositionSize = await calculatePositionSize(POSITION_SIZE, POSITION_SIZE_TYPE, TRADING_PAIR, FIXED_STOP_DISTANCE, POSITION_SIZE_PRECISION)
      console.log(`[Strategy: ethquake] Calculated position size: ${calculatedPositionSize} units`)

      try {
        trailingStopResult = await placeStandaloneOrder(
          'trailing_stop',
          direction === 'buy' ? 'sell' : 'buy',
          calculatedPositionSize,
          TRADING_PAIR,
          { distance: TRAILING_STOP_DISTANCE, deviationUnit: 'PERCENT' },
          true
        )
        if (trailingStopResult?.result !== 'success') throw new Error('Failed to place trailing stop')
      } catch (trailingStopError) {
        console.error('[Strategy: ethquake] Error placing trailing stop:', trailingStopError)
        throw new Error('Failed to place trailing stop')
      }

      const currentPrice = await getCurrentPrice(TRADING_PAIR)
      const fixedStopPrice = roundPrice(
        direction === 'buy'
          ? currentPrice * (1 - FIXED_STOP_DISTANCE / 100)
          : currentPrice * (1 + FIXED_STOP_DISTANCE / 100),
        getPricePrecision(TRADING_PAIR)
      )

      const fixedStopConfig = { type: 'fixed' as const, distance: FIXED_STOP_DISTANCE, stopPrice: fixedStopPrice }
      orderResult = await placeOrderWithExits(direction, calculatedPositionSize, fixedStopConfig, { type: 'none', price: 0 }, TRADING_PAIR, false, 'ethquake', 'fixed', POSITION_SIZE_PRECISION)
    }

    await db.collection('trading_signals').insertOne({
      signal_hour: signalHour,
      created_at: new Date(),
      direction: direction,
      ema_data: indicators,
      market_order_id: orderResult?.marketOrder?.sendStatus?.order_id || null,
      market_order_status: orderResult?.marketOrder?.sendStatus?.status || 'failed',
      fixed_stop_order_id: orderResult?.stopOrder?.sendStatus?.order_id || null,
      fixed_stop_status: orderResult?.stopOrder?.sendStatus?.status || 'failed',
      trailing_stop_order_id: trailingStopResult?.sendStatus?.order_id || null,
      trailing_stop_status: trailingStopResult?.sendStatus?.status || 'failed',
      result: orderResult?.marketOrder?.result || 'failed',
      error: orderResult?.error || null,
      dynamic_threshold: true,
      sum2h: recentResults[0].count + recentResults[1].count
    })

    const trailingStopInfo = trailingStopResult?.result === 'success'
      ? `\nTrailing Stop: ${trailingStopResult.sendStatus.status}`
      : '\nTrailing Stop: failed'

    sendAlert(`Signal detected - Entered ${direction} order at ${signalHour.toISOString()}\nSum2h=${recentResults[0].count + recentResults[1].count} Dyn=${signalThreshold}\nOrder Result: ${orderResult?.marketOrder?.result || 'failed'}\nFixed Stop Order Result: ${orderResult?.stopOrder?.sendStatus?.status || 'failed'}${trailingStopInfo}`)
    return { signalHour, direction, orderResult, trailingStopResult }

  } catch (error) {
    console.error('[Strategy: ethquake] Error executing trading strategy:', error)
    throw error
  }
}