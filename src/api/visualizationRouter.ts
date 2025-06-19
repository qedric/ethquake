import express from 'express'
import { getDb } from '../lib/mongodb.js'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const router = express.Router()

// Constants
const PROD_DB = process.env.MONGO_DB_NAME || 'ethquake'
const TEST_DB = 'ethquake_b'

// Serve the chart page
router.get('/', (req, res) => {
  console.log('[Web Request] Serving chart visualization page')
  res.sendFile(path.join(__dirname, '../../src/public/charts.html'))
})

// API endpoint to get chart data
router.get('/data', async (req, res) => {
  try {
    const dbName = req.query.db === 'ethquake_b' ? TEST_DB : PROD_DB
    console.log(`[Web Request] Connecting to ${dbName} database for chart data`)
    
    const db = await getDb(dbName)
    console.log(`[Web Request] Fetching transaction analysis results from ${dbName}`)
    
    const transactions = await db.collection('transactions_per_hour')
      .find({})
      .sort({ timestamp: 1 })
      .toArray()
      
    console.log(`[Web Request] Successfully retrieved ${transactions.length} data points from ${dbName}`)
    res.json(transactions)
  } catch (error) {
    console.error('[Web Request] Error fetching chart data:', error)
    res.status(500).json({ error: 'Failed to fetch chart data' })
  }
})

export default router 