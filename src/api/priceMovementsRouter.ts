import express from 'express'
import { getDb } from '../lib/mongodb.js'
import { buildCohort } from '../strategies/ethquake/scripts/refreshAddresses.js'

const router = express.Router()

router.post('/alert', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const secret = process.env.PRICE_MOVEMENT_WEBHOOK_SECRET
    const { secret: bodySecret, symbol, method, threshold, timestamp } = req.body || {}
    const clientIP = req.ip || (req.connection as any)?.remoteAddress || 'unknown'

    console.log('[PriceMovements] Received alert', {
      path: req.path,
      ip: clientIP,
      hasSecret: Boolean(bodySecret),
      symbol,
      method,
      threshold,
      timestamp
    })

    if (!secret || !bodySecret || bodySecret !== secret) {
      console.warn('[PriceMovements] Unauthorized alert', {
        reason: !secret ? 'server_missing_secret' : (!bodySecret ? 'missing_secret' : 'secret_mismatch'),
        ip: clientIP
      })
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    if (!timestamp || typeof timestamp !== 'number') {
      console.warn('[PriceMovements] Invalid timestamp', { timestamp, ip: clientIP })
      res.status(400).json({ error: 'missing or invalid timestamp' })
      return
    }

    const db = await getDb(process.env.MONGO_DB_NAME || 'ethquake')

    const doc = {
      timestamp,
      date: new Date(timestamp * 1000),
      symbol: symbol || 'ETHUSD',
      method: method === 'range' ? 'range' : 'close',
      threshold: typeof threshold === 'number' ? threshold : 6,
      source: 'tradingview',
      created_at: new Date()
    }

    const result = await db.collection('price_movements').updateOne(
      { timestamp: doc.timestamp },
      { $setOnInsert: doc },
      { upsert: true }
    )
    console.log('[PriceMovements] Stored price movement', {
      timestamp: doc.timestamp,
      upsertedId: (result as any).upsertedId || null,
      matchedCount: (result as any).matchedCount,
      modifiedCount: (result as any).modifiedCount
    })

    // Auto refresh candidates only on a fresh insert (debounced by upsert)
    if (process.env.AUTO_REFRESH_COHORT === '1' && (result as any).upsertedId) {
      const lookbackHours = parseInt(process.env.REFRESH_LOOKBACK_HOURS || '2')
      const weeklyControls = parseInt(process.env.REFRESH_WEEKLY_CONTROLS || '4')
      const randomCtrls = parseInt(process.env.REFRESH_RANDOM_CONTROLS || '2')
      const minEth = parseInt(process.env.REFRESH_MIN_ETH || '100')
      const cohort = new Date().toISOString().slice(0, 10)

      const fromTs = doc.timestamp - lookbackHours * 3600
      const toTs = doc.timestamp

      console.log('[PriceMovements] Auto-refreshing candidates', {
        cohort,
        fromTs,
        toTs,
        lookbackHours,
        weeklyControls,
        randomCtrls,
        minEth
      })
      try {
        await buildCohort({
          lookbackHours,
          weeklyControls,
          randomControls: randomCtrls,
          minEth,
          fromTimestamp: fromTs,
          toTimestamp: toTs,
          cohort
        })
        console.log('[PriceMovements] Auto-refresh completed')
      } catch (e) {
        console.error('[PriceMovements] Auto-refresh failed', e)
      }
    }

    res.json({ ok: true })
  } catch (err) {
    console.error('[PriceMovements] Alert error', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
