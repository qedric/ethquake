import dotenv from 'dotenv'
import transactionDataRouter from '../api/transactionData.js'
import visualizationRouter from '../api/visualizationRouter.js'
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

const STRATEGIES_DIR = path.join(__dirname, '../strategies')

// Define types for strategy configuration and loaded strategy
interface StrategyConfig {
  name: string
  enabled: boolean
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
    // Try run.ts first (dev), then run.js (prod)
    let entryPath = path.join(strategyPath, 'run.ts')
    if (!fs.existsSync(entryPath)) {
      entryPath = path.join(strategyPath, 'run.js')
      if (!fs.existsSync(entryPath)) {
        console.log(`No run.ts or run.js found for strategy ${folder}`)
        continue
      }
    }

    if (!fs.existsSync(configPath)) {
      console.log(`No strategy.json found for strategy ${folder}`)
      continue
    }

    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8')) as StrategyConfig
    if (!config.enabled) {
      console.log(`Strategy ${folder} is disabled in config`)
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

      // Run the pipeline task once to initialize
      console.log(`Initializing strategy ${config.name}...`)
      await mod.runPipelineTask()
      
      strategies[config.name] = {
        config,
        runPipelineTask: mod.runPipelineTask
      }
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

// Keep the process alive with proper initialization
async function startServer() {
  try {
    // Load strategies first
    await loadStrategies()
    
    // Start Express server
    const server = app.listen(PORT, () => {
      console.log(`Ethquake Server running on port ${PORT}.`)
    })

    // Add the router with authentication
    app.use('/api/transactions', authMiddleware, transactionDataRouter)
    app.use(express.static(path.join(__dirname, '../public')))
    app.use('/charts', authMiddleware, visualizationRouter)
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

// Status endpoint - might be useful someday, who knows
app.get('/status', authMiddleware, async (req, res) => {
  try {
    const strategyStatuses = Object.entries(strategies).map(([name, strategy]) => ({
      name,
      enabled: strategy.config.enabled,
      schedule: strategy.config.cronSchedule
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