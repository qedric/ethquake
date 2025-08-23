import express from 'express'
import { getDb } from '../lib/mongodb.js'

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

    res.json({ ok: true })
  } catch (err) {
    console.error('[PriceMovements] Alert error', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
