import dotenv from 'dotenv'
import transactionDataRouter from '../api/transactionData.js'
import visualizationRouter from '../api/visualizationRouter.js'
import strategiesRouter from '../api/strategiesRouter.js'
import tradingViewRouter from '../api/tradingViewRouter.js'
import ledgerRouter from '../api/ledgerRouter.js'
import ledgerDashboardRouter from '../api/ledgerDashboardRouter.js'
import path from 'path'
import basicAuth from 'express-basic-auth'
import express from 'express'
import cron from 'node-cron'
import fs from 'fs'
import { fileURLToPath } from 'url'

// Load those pesky environment variables that you can't seem to organize properly
dotenv.config()

// Get __dirname equivalent for ES modules
const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

// Basic authentication middleware
const authMiddleware = basicAuth({
  users: { [process.env.BASIC_AUTH_USER as string]: process.env.BASIC_AUTH_PASSWORD! },
  challenge: true
})

const app = express()
const PORT = process.env.PORT || 8080

// Trust proxy headers (needed for Railway and other cloud platforms)
app.set('trust proxy', true)

// Add JSON body parser middleware
app.use(express.json())

// When running npm start, we want dist/
// When running npm run dev, we want src/
const isDev = process.env.NODE_NO_WARNINGS === '1' // This is set in our dev script
const STRATEGIES_DIR = isDev
  ? path.join(process.cwd(), 'src/strategies')
  : path.join(process.cwd(), 'dist/strategies')

// Define types for strategy configuration and loaded strategy
interface StrategyConfig {
  name: string
  enabled: boolean
  enabled_dev?: boolean
  description?: string
  cronSchedule: string
}

interface LoadedStrategy {
  config: StrategyConfig
  runPipelineTask: () => Promise<any>
}

const strategies: Record<string, LoadedStrategy> = {}

async function loadStrategies() {
  console.log('Loading strategies from:', STRATEGIES_DIR)
  const strategyFolders = fs.readdirSync(STRATEGIES_DIR, { withFileTypes: true })
    .filter(dirent => dirent.isDirectory())
    .map(dirent => dirent.name)
  
  console.log('Found strategy folders:', strategyFolders)

  for (const folder of strategyFolders) {
    const strategyPath = path.join(STRATEGIES_DIR, folder)
    const configPath = path.join(strategyPath, 'strategy.json')
    // In dev mode, use .ts, in prod mode use .js
    const entryPath = path.join(strategyPath, isDev ? 'run.ts' : 'run.js')
    
    if (!fs.existsSync(entryPath)) {
      console.log(`No ${isDev ? 'run.ts' : 'run.js'} found for strategy ${folder}`)
      continue
    }

    if (!fs.existsSync(configPath)) {
      console.log(`No strategy.json found for strategy ${folder}`)
      continue
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StrategyConfig
    
    // Store strategy regardless of enabled status
    strategies[config.name] = {
      config,
      runPipelineTask: async () => {} // Placeholder for disabled strategies
    }

    // Check if strategy is enabled for current environment
    const isEnabledForEnvironment = isDev 
      ? (config.enabled_dev === true)
      : config.enabled
    
    if (!isEnabledForEnvironment) {
      const reason = isDev && !config.enabled_dev 
        ? 'disabled for dev mode' 
        : 'disabled in config'
      console.log(`Strategy ${folder} is ${reason}`)
      continue
    }

    if (!config.cronSchedule) {
      console.log(`Strategy ${folder} is missing cronSchedule in config`)
      continue
    }

    console.log(`Loading strategy ${folder} from ${entryPath}`)
    try {
      const mod = await import(entryPath)
      
      if (typeof mod.runPipelineTask !== 'function') {
        console.warn(`Strategy ${config.name} does not export runPipelineTask`)
        continue
      }

      strategies[config.name].runPipelineTask = mod.runPipelineTask
      console.log(`Successfully loaded strategy ${config.name}`)

      // Set up cron job immediately after strategy is loaded
      console.log(`Setting up cron job for strategy ${config.name} with schedule: ${config.cronSchedule}`)
      cron.schedule(config.cronSchedule, async () => {
        console.log(`Running pipeline for ${config.name} at ${new Date().toISOString()}`)
        try {
          await mod.runPipelineTask()
          console.log(`Successfully completed pipeline for ${config.name}`)
        } catch (err) {
          console.error(`Error running pipeline for ${config.name}:`, err)
        }
      })
    } catch (err) {
      console.error(`Failed to load strategy ${folder}:`, err)
    }
  }
}

// Status endpoint - might be useful someday, who knows
app.get('/status', authMiddleware, async (req, res) => {
  try {
    const strategyStatuses = Object.entries(strategies).map(([name, strategy]) => ({
      name,
      enabled: strategy.config.enabled,
      enabled_dev: strategy.config.enabled_dev,
      schedule: strategy.config.cronSchedule,
      description: strategy.config.description
    }))

    res.json({
      status: 'operational',
      strategies: strategyStatuses,
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

// Keep the process alive with proper initialization
async function startServer() {
  try {
    // Load strategies first
    await loadStrategies()
    
    // Add the routers BEFORE starting the server
    app.use('/api/transactions', authMiddleware, transactionDataRouter)
    app.use('/api/tv', tradingViewRouter) // TradingView webhooks don't need auth
    app.use('/api/ledger', authMiddleware, ledgerRouter)
    app.use(express.static(path.join(__dirname, '../public')))
    app.use('/charts', authMiddleware, visualizationRouter)
    app.use('/strategies', authMiddleware, strategiesRouter)
    app.use('/ledger', authMiddleware, ledgerDashboardRouter)
    
    // Start Express server
    app.listen(PORT, () => {
      console.log(`Ethquake Server running on port ${PORT}.`)
    })
  } catch (error) {
    console.error('Failed to start server:', error)
    // Important: Don't exit on startup error, retry instead
    setTimeout(() => startServer(), 5000)
  }
}

startServer()

// Heartbeat for logs but not too frequent
setInterval(() => {
  console.log('Server heartbeat check')
}, 300000) // 5 minutes instead of 1 minute 