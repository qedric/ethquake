import express from 'express'
import { connectToDatabase } from '../lib/mongodb.js'

const router = express.Router()

router.get('/hourly', async (req, res) => {
  try {
    // Use the db query parameter if provided, otherwise use default
    const dbName = req.query.db || process.env.MONGO_DB_NAME || 'ethquake'
    const db = await connectToDatabase(dbName)
    
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
      return res.json([])
    }

    // Get the date range
    const startDate = new Date(formattedData[0].timestamp)
    const endDate = new Date(formattedData[formattedData.length - 1].timestamp)
    
    // Create a map of existing data points for quick lookup
    const dataMap = new Map()
    formattedData.forEach(item => {
      const key = `${item.timestamp.getTime()}`
      dataMap.set(key, item)
    })
    
    // Generate all hours in the range
    const allHours = []
    let currentDate = new Date(startDate)
    currentDate.setUTCHours(0, 0, 0, 0) // Start at beginning of first day
    
    while (currentDate <= endDate) {
      // Generate all 24 hours for this day
      for (let hour = 0; hour < 24; hour++) {
        const hourDate = new Date(currentDate)
        hourDate.setUTCHours(hour)
        
        const key = `${hourDate.getTime()}`
        if (dataMap.has(key)) {
          // Use existing data
          allHours.push(dataMap.get(key))
        } else {
          // Create zero count entry for missing hour
          allHours.push({
            timestamp: hourDate,
            hour: hour,
            count: 0,
            displayDateHour: formatDateHour(hourDate)
          })
        }
      }
      
      // Move to next day
      currentDate.setUTCDate(currentDate.getUTCDate() + 1)
    }
    
    return res.json(allHours)
  } catch (error) {
    console.error('Failed to fetch transaction data:', error)
    return res.status(500).json({ error: 'Failed to fetch transaction data' })
  }
})

// Helper function to format date and hour
function formatDateHour(date) {
  const day = date.getUTCDate().toString().padStart(2, '0')
  const month = (date.getUTCMonth() + 1).toString().padStart(2, '0')
  const year = date.getUTCFullYear().toString().substring(2)
  const hour = date.getUTCHours().toString().padStart(2, '0')
  return `${day}/${month}/${year} - ${hour}`
}

export default router 