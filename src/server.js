import express from 'express'
import cron from 'node-cron'
import { updateTransactionsByAddressesOfInterest } from './scripts/updateTransactionsByAddress.js'
import { countTransactionsByHour } from './scripts/txCountByHour.js'
import { executeTradeStrategy } from './trading/strategy.js'
import { getDb, connectToDatabase, logActivity } from './lib/mongodb.js'
import dotenv from 'dotenv'

// Load those pesky environment variables that you can't seem to organize properly
dotenv.config()

const app = express()
const PORT = process.env.PORT || 8080
let server = null

// Basic health check endpoint for Railway
app.get('/', (req, res) => {
  res.send('EthQuake Trading Server is running. Go away.')
})

// Add a proper health check endpoint that Railway can use
app.get('/health', (req, res) => {
  res.status(200).send({ status: 'ok' })
})

// Proper error handling to prevent crashes
process.on('uncaughtException', (error) => {
  console.error('Uncaught Exception:', error)
  logActivity({
    type: 'UNCAUGHT_EXCEPTION',
    error: error.message,
    stack: error.stack
  }).catch(err => console.error('Failed to log uncaught exception:', err))
})

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason)
  logActivity({
    type: 'UNHANDLED_REJECTION',
    reason: reason?.message || String(reason)
  }).catch(err => console.error('Failed to log unhandled rejection:', err))
})

// Handle shutdown gracefully
process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down gracefully')
  
  try {
    await logActivity({
      type: 'SERVER_SHUTDOWN',
      reason: 'SIGTERM received'
    })
    
    // Close the server
    if (server) {
      server.close(() => {
        console.log('Server closed')
        process.exit(0)
      })
    } else {
      process.exit(0)
    }
    
    // Force exit after 5 seconds if not closed gracefully
    setTimeout(() => {
      console.log('Forcing shutdown after timeout')
      process.exit(1)
    }, 5000)
  } catch (error) {
    console.error('Error during shutdown:', error)
    process.exit(1)
  }
})

// Keep the process alive with proper initialization
async function startServer() {
  try {
    // Connect to MongoDB first
    await connectToDatabase()
    
    // Start Express server
    server = app.listen(PORT, () => {
      console.log(`EthQuake Server running on port ${PORT}.`)
      logActivity({
        type: 'SERVER_START',
        port: PORT
      }).catch(err => console.error('Failed to log server start:', err))
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    // Important: Don't exit on startup error, retry instead
    setTimeout(startServer, 5000)
  }
}

startServer()

// Heartbeat for logs but not too frequent
setInterval(() => {
  console.log('Server heartbeat check')
}, 300000) // 5 minutes instead of 1 minute

// Status endpoint - might be useful someday, who knows
app.get('/status', async (req, res) => {
  try {
    const db = await getDb()
    const txCount = await db.collection('transactions').countDocuments()
    const analysisCount = await db.collection('analysis_results').countDocuments()
    res.json({
      status: 'operational',
      transactions: txCount,
      analysisResults: analysisCount,
      lastUpdate: new Date().toISOString()
    })
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Main cron job that runs your data pipeline every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  console.log('Running scheduled task:', new Date().toISOString())
  
  try {
    // Update transactions data
    console.log('Updating transactions data...')
    const txResult = await updateTransactionsByAddressesOfInterest()
    console.log(`Added ${txResult.newTransactionsCount} new transactions`)
    
    // Run analysis
    console.log('Running transaction analysis...')
    const analysisResults = await countTransactionsByHour()
    console.log(`Analysis complete with ${analysisResults?.length || 0} hourly results`)
    
    // Execute trading strategy based on the latest analysis
    console.log('Executing trading strategy...')
    await executeTradeStrategy()
    
  } catch (error) {
    console.error('Error in scheduled task:', error)
  }
}) 