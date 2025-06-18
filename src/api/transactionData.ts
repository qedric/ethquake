import express from 'express'
import { getDb } from '../lib/mongodb.js'

const router = express.Router()

router.get('/hourly', async (req, res): Promise<void> => {
  try {
    // Use the db query parameter if provided, otherwise use default
    let dbName: string | undefined = process.env.MONGO_DB_NAME || 'ethquake'
    if (typeof req.query.db === 'string') {
      dbName = req.query.db
    }
    const db = await getDb(dbName)
    
    // Get data from MongoDB
    const transactions = await db.collection('transactions_per_hour')
      .find({})
      .sort({ timestamp: 1 })
      .toArray()
      
    // Format for API response
    const formattedData = transactions.map(tx => ({
      timestamp: tx.timestamp,
      hour: tx.hour,
      count: tx.count,
      displayDateHour: tx.display_date_hour
    }))

    // If we have no data, return empty array
    if (formattedData.length === 0) {
      res.json([])
      return
    }
    
    res.json(formattedData)
  } catch (error) {
    console.error('Failed to fetch transaction data:', error)
    res.status(500).json({ error: 'Failed to fetch transaction data' })
  }
})

export default router 