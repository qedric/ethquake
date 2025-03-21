import express from 'express'
import { getDb } from '../lib/mongodb.js'

const router = express.Router()

router.get('/hourly', async (req, res) => {
  try {
    const db = await getDb()
    
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
    
    return res.json(formattedData)
  } catch (error) {
    console.error('Failed to fetch transaction data:', error)
    return res.status(500).json({ error: 'Failed to fetch transaction data' })
  }
})

export default router 