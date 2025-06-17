import { getDb, connectToDatabase, logActivity } from '@/strategies/ethquake/database/mongodb'
import { selectDatabase } from '@/strategies/ethquake/database/dbSelector'
import dotenv from 'dotenv'
import transactionDataRouter from '@/api/transactionData'
import visualizationRouter from '@/api/visualizationRouter'
import path from 'path'
import basicAuth from 'express-basic-auth'
import express from 'express'
import cron from 'node-cron'
import fs from 'fs'

// Load those pesky environment variables that you can't seem to organize properly
dotenv.config()

// Basic authentication middleware
const authMiddleware = basicAuth({
  users: { [process.env.BASIC_AUTH_USER as string]: process.env.BASIC_AUTH_PASSWORD! },
  challenge: true
})

const app = express()
const PORT = process.env.PORT || 8080
let server: any = null

// Define __dirname equivalent for ES modules
// const __filename = fileURLToPath(import.meta.url)
// const __dirname = path.dirname(__filename)

const STRATEGIES_DIR = path.join(__dirname, '../strategies')

// Define types for strategy configuration and loaded strategy
interface StrategyConfig {
  name: string
  enabled: boolean
  description?: string
}

interface LoadedStrategy {
  config: StrategyConfig
  runPipelineTask: () => Promise<any>
}

const strategies: Record<string, LoadedStrategy> = {}

function loadStrategies() {
  const strategyFolders = fs.readdirSync(STRATEGIES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)

  for (const folder of strategyFolders) {
    const strategyPath = path.join(STRATEGIES_DIR, folder)
    const configPath = path.join(strategyPath, 'strategy.json')
    // Try run.ts first (dev), then run.js (prod)
    let entryPath = path.join(strategyPath, 'run.ts')
    if (!fs.existsSync(entryPath)) {
      entryPath = path.join(strategyPath, 'run.js')
      if (!fs.existsSync(entryPath)) continue
    }

    if (!fs.existsSync(configPath)) continue

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StrategyConfig
    if (!config.enabled) continue

    import(entryPath).then(mod => {
      if (typeof mod.runPipelineTask !== 'function') {
        console.warn(`Strategy ${config.name} does not export runPipelineTask`)
        return
      }
      strategies[config.name] = {
        config,
        runPipelineTask: mod.runPipelineTask
      }
      cron.schedule('*/15 * * * *', async () => {
        try {
          await mod.runPipelineTask()
        } catch (err) {
          console.error(`Error running pipeline for ${config.name}:`, err)
        }
      })
    }).catch(err => {
      console.error(`Failed to load strategy ${folder}:`, err)
    })
  }
}

// Call this at startup
loadStrategies()

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
    reason: reason && typeof reason === 'object' && 'message' in reason ? (reason as any).message : String(reason)
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
    await connectToDatabase(typeof dbName === 'string' ? dbName : undefined)
    
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
        res.status(500).json({ 
          status: 'degraded',
          error: 'Database connection unavailable',
          lastUpdate: new Date().toISOString()
        })
        return
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
    res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
  }
})

// Manual trigger endpoint
app.post('/run-pipeline/:strategy', authMiddleware, async (req, res) => {
  const { strategy } = req.params
  const strat = strategies[strategy]
  if (!strat) {
    res.status(404).json({ error: 'Strategy not found or not enabled' })
    return
  }

  try {
    const result = await strat.runPipelineTask()
    res.json(result)
  } catch (err) {
    res.status(500).json({ error: err instanceof Error ? err.message : String(err) })
  }
}) 