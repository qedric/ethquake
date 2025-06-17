import express from 'express'
import cron from 'node-cron'
import { updateTransactionsByAddressesOfInterest } from '@/strategies/ethquake/scripts/updateTransactionsByAddress.js'
import { countTransactionsByHour } from '@/strategies/ethquake/scripts/txCountByHour.js'
import { executeTradeStrategy } from '@/strategies/ethquake/strategy.js'
import { getDb, connectToDatabase, logActivity } from '@/strategies/ethquake/database/mongodb.js'
import { selectDatabase } from '@/strategies/ethquake/database/dbSelector.js'
import dotenv from 'dotenv'
import transactionDataRouter from '@/api/transactionData.js'
import visualizationRouter from '@/api/visualizationRouter.js'
import path from 'path'
import { fileURLToPath } from 'url'
import basicAuth from 'express-basic-auth'

// Load those pesky environment variables that you can't seem to organize properly
dotenv.config()

// Basic authentication middleware
const authMiddleware = basicAuth({
  users: { [process.env.BASIC_AUTH_USER]: process.env.BASIC_AUTH_PASSWORD },
  challenge: true
})

const app = express()
const PORT = process.env.PORT || 8080
let server = null

// Define __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Add authentication to routes
app.get('/', authMiddleware, (req, res) => {
  res.send('Ethquake Server is running. Go away.')
})

app.get('/health', authMiddleware, (req, res) => {
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

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM signal received: closing HTTP server')
  server.close(() => {
    console.log('HTTP server closed')
    // Close database connection if needed
    // disconnectFromDatabase()
    process.exit(0)
  })
})

// Keep the process alive with proper initialization
async function startServer() {
  try {
    // Select database in development mode
    const dbName = await selectDatabase()
    
    // Connect to MongoDB first
    await connectToDatabase(dbName)
    
    // Start Express server
    server = app.listen(PORT, () => {
      console.log(`Ethquake Server running on port ${PORT}.`)
      logActivity({
        type: 'SERVER_START',
        port: PORT,
        database: dbName
      }).catch(err => console.error('Failed to log server start:', err))
    })

    // Add the router with authentication
    app.use('/api/transactions', authMiddleware, transactionDataRouter)
    app.use(express.static(path.join(__dirname, 'public')))
    app.use('/charts', authMiddleware, visualizationRouter)
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
app.get('/status', authMiddleware, async (req, res) => {
  try {
    // First check if we're connected to the database
    let db
    try {
      db = await getDb()
    } catch (error) {
      console.log('attempting reconnect - ', error)
      // Try to reconnect
      try {
        await connectToDatabase()
        db = await getDb()
      } catch (reconnectError) {
        console.error('Failed to reconnect to database:', reconnectError)
        return res.status(500).json({ 
          status: 'degraded',
          error: 'Database connection unavailable',
          lastUpdate: new Date().toISOString()
        })
      }
    }
    
    // If we've made it this far, MongoDB has graciously decided to work
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

// Extract the pipeline task into a separate function so you can 
// manually trigger it like the control freak you are
async function runDataPipelineTask() {
  console.log('Running data pipeline task:', new Date().toISOString())
  
  try {
    // Get the current database connection
    const db = await getDb()
    const client = db.client
    
    // Update transactions data
    console.log('Updating transactions data...')
    const txResult = await updateTransactionsByAddressesOfInterest({
      existingDb: db,
      existingClient: client
    })
    console.log(`Added ${txResult.newTransactionsCount} new transactions`)
    
    // Run analysis
    console.log('Running transaction analysis...')
    const analysisResults = await countTransactionsByHour(db, client)
    console.log(`Analysis complete with ${analysisResults?.length || 0} hourly results`)
    
    // Only execute trading strategy in production
    if (process.env.NODE_ENV === 'production') {
      console.log('Executing trading strategy...')
      await executeTradeStrategy()
    } else {
      console.log('Skipping trading strategy in non-production environment')
    }
    
    return { success: true }
  } catch (error) {
    console.error('Error in data pipeline task:', error)
    return { success: false, error: error.message }
  }
}

// Add an authenticated endpoint so you can manually trigger the task
// without exposing it to every random internet user with a browser
app.post('/run-pipeline', authMiddleware, async (req, res) => {
  const apiKey = req.headers['x-api-key']
  
  // Check if the API key is valid - can't believe I have to explain this
  if (!apiKey || apiKey !== process.env.API_SECRET_KEY) {
    return res.status(401).json({ error: 'Unauthorized. Nice try.' })
  }
  
  try {
    const result = await runDataPipelineTask()
    res.json(result)
  } catch (error) {
    res.status(500).json({ error: error.message })
  }
})

// Main cron job that runs your data pipeline every 15 minutes
cron.schedule('*/15 * * * *', async () => {
  await runDataPipelineTask()
}) 