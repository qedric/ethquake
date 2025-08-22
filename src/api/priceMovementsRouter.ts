import express from 'express'
import { getDb } from '../lib/mongodb.js'

const router = express.Router()

router.post('/alert', async (req: express.Request, res: express.Response): Promise<void> => {
  try {
    const secret = process.env.PRICE_MOVEMENT_WEBHOOK_SECRET
    const { secret: bodySecret, symbol, method, threshold, timestamp } = req.body || {}

    if (!secret || !bodySecret || bodySecret !== secret) {
      res.status(401).json({ error: 'unauthorized' })
      return
    }

    if (!timestamp || typeof timestamp !== 'number') {
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

    await db.collection('price_movements').updateOne(
      { timestamp: doc.timestamp },
      { $setOnInsert: doc },
      { upsert: true }
    )

    res.json({ ok: true })
  } catch (err) {
    console.error('price movement alert error', err)
    res.status(500).json({ error: 'internal error' })
  }
})

export default router
