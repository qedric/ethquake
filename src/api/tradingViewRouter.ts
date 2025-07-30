import express from 'express'
import { getDb } from '../lib/mongodb.js'

const router = express.Router()

interface TradingViewAlert {
  strategy: {
    order: {
      action: string
      contracts: number
    }
    position_size: number
  }
  ticker: string
  message: string
  timestamp?: string
}

// Store webhook alerts in MongoDB
async function storeAlert(alert: TradingViewAlert) {
  const db = await getDb('tradingview_alerts')
  const collection = db.collection('alerts')
  
  const alertDoc = {
    ...alert,
    received_at: new Date(),
    processed: false
  }
  
  await collection.insertOne(alertDoc)
  console.log('Stored TradingView alert:', alertDoc)
}

// TradingView webhook validation
function validateTradingViewRequest(req: express.Request): boolean {
  const webhookSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET
  
  // If no secret is configured, only validate User-Agent
  if (!webhookSecret) {
    const userAgent = req.headers['user-agent'] as string
    if (userAgent && userAgent.includes('TradingView')) {
      console.log('Validated TradingView User-Agent:', userAgent)
      return true
    }
    console.warn('No TradingView validation configured, allowing request')
    return true
  }
  
  // If secret is configured, require it in the message
  if (req.body.message && req.body.message.includes(webhookSecret)) {
    console.log('Validated secret token in message')
    return true
  }
  
  console.warn('TradingView validation failed - secret token not found in message')
  return false
}

// Prevent replay attacks by checking timestamp
function validateTimestamp(req: express.Request): boolean {
  const timestamp = req.body.timestamp
  if (!timestamp) {
    console.warn('No timestamp provided in webhook request')
    return false
  }
  
  const requestTime = new Date(timestamp).getTime()
  const currentTime = Date.now()
  const maxAge = 5 * 60 * 1000 // 5 minutes in milliseconds
  
  if (Math.abs(currentTime - requestTime) > maxAge) {
    console.warn(`Webhook timestamp too old: ${timestamp}, current: ${new Date().toISOString()}`)
    return false
  }
  
  console.log('Timestamp validation passed')
  return true
}

// TradingView webhook endpoint
router.post('/alert-hook', (req, res) => {
  console.log('Received TradingView webhook:', req.body)
  
      // Validate TradingView request
    if (!validateTradingViewRequest(req)) {
      res.status(401).json({ error: 'Invalid TradingView request' })
      return
    }
    
    // Validate timestamp to prevent replay attacks
    if (!validateTimestamp(req)) {
      res.status(401).json({ error: 'Invalid timestamp or replay attack detected' })
      return
    }
  
  const alert: TradingViewAlert = {
    strategy: req.body.strategy,
    ticker: req.body.ticker,
    message: req.body.message,
    timestamp: req.body.timestamp || new Date().toISOString()
  }
  
  // Validate required fields
  if (!alert.strategy?.order?.action || !alert.ticker) {
    console.warn('Invalid TradingView alert received:', req.body)
    res.status(400).json({ error: 'Missing required fields' })
    return
  }
  
  // Store the alert
  storeAlert(alert).then(() => {
    // Process the alert based on the action
    const action = alert.strategy.order.action.toLowerCase()
    const ticker = alert.ticker
    const contracts = alert.strategy.order.contracts
    
    console.log(`Processing ${action} order for ${contracts} contracts on ${ticker}`)
    
    // TODO: Implement actual trading logic here
    // This would integrate with your existing trading infrastructure
    
    res.status(200).json({ 
      success: true, 
      message: 'Alert received and processed',
      action,
      ticker,
      contracts
    })
  }).catch((error) => {
    console.error('Error processing TradingView webhook:', error)
    res.status(500).json({ 
      error: 'Internal server error',
      details: error instanceof Error ? error.message : String(error)
    })
  })
})

// Get recent alerts (for debugging/monitoring)
router.get('/alerts', (req, res) => {
  getDb('tradingview_alerts').then((db) => {
    const collection = db.collection('alerts')
    
    const limit = parseInt(req.query.limit as string) || 50
    return collection
      .find({})
      .sort({ received_at: -1 })
      .limit(limit)
      .toArray()
  }).then((alerts) => {
    res.json(alerts)
  }).catch((error) => {
    console.error('Error fetching alerts:', error)
    res.status(500).json({ error: 'Failed to fetch alerts' })
  })
})

export default router 