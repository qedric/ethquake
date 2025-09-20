import express from 'express'
import { getDb } from '../lib/mongodb.js'
import { executeTradingViewTrade } from '../trading/webhooks.js'
import { sendAlert } from '../alerts/index.js'

const router = express.Router()

// Simple in-memory deduplication of TradingView alerts
// Prevents processing identical alerts received within a short time window
const recentAlerts = new Map<string, number>()
const DEDUPE_WINDOW_MS = 10000

function makeAlertKey(body: any): string {
  const action = (body?.strategy?.order?.action || '').toLowerCase()
  const ticker = (body?.ticker || '').toUpperCase()
  const current = (body?.strategy?.current_position || '').toLowerCase()
  const prev = (body?.strategy?.prev_position || '').toLowerCase()
  // Include sanitized message without secret to tighten key without leaking secrets
  const message = typeof body?.message === 'string' ? body.message : ''
  return `${ticker}|${action}|${prev}->${current}|${message}`
}

function isDuplicateAlert(key: string, now: number): boolean {
  const last = recentAlerts.get(key)
  if (last && now - last < DEDUPE_WINDOW_MS) return true
  return false
}

function rememberAlert(key: string, now: number) {
  recentAlerts.set(key, now)
  // Opportunistic cleanup of old entries
  for (const [k, t] of recentAlerts) {
    if (now - t > 60_000) recentAlerts.delete(k)
  }
}

interface TradingViewAlert {
  strategy: {
    order: {
      action: string
      contracts?: number
    }
    current_position: string
    prev_position: string
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

  console.log('Request headers:', req.headers)
  console.log('Client IP:', req.ip)
  console.log('X-Forwarded-For:', req.headers['x-forwarded-for'])

  // Method 1: Check IP whitelist (TradingView's official IPs)
  const clientIP = req.ip || req.connection.remoteAddress || ''
  const allowedIPs = [
    '52.89.214.238',
    '34.212.75.30',
    '54.218.53.128',
    '52.32.178.7'
  ]

  if (allowedIPs.includes(clientIP)) {
    console.log('Validated TradingView IP address:', clientIP)
    return true
  }

  // Method 2: Check X-Forwarded-For header as fallback
  const forwardedFor = req.headers['x-forwarded-for'] as string
  if (forwardedFor) {
    const forwardedIPs = forwardedFor.split(',').map(ip => ip.trim())
    const firstForwardedIP = forwardedIPs[0]
    
    if (allowedIPs.includes(firstForwardedIP)) {
      console.log('Validated TradingView IP from X-Forwarded-For:', firstForwardedIP)
      return true
    }
  }

  // Method 3: Check for secret token in message
  if (req.body.message && req.body.message.includes(webhookSecret)) {
    console.log('Validated secret token in message')
    return true
  }

  console.warn('TradingView validation failed - IP not whitelisted and secret token not found in message')
  return false
}

// Prevent replay attacks by checking timestamp
function validateTimestamp(req: express.Request): boolean {
  // Method 1: Check if TradingView included a timestamp in the body
  const bodyTimestamp = req.body.timestamp
  if (bodyTimestamp) {
    const requestTime = new Date(bodyTimestamp).getTime()
    const currentTime = Date.now()
    const maxAge = 5 * 60 * 1000 // 5 minutes in milliseconds

    if (Math.abs(currentTime - requestTime) > maxAge) {
      console.warn(`Webhook timestamp too old: ${bodyTimestamp}, current: ${new Date().toISOString()}`)
      return false
    }

    console.log('Timestamp validation passed using body timestamp')
    return true
  }

  // Method 2: Use Railway's x-request-start header as fallback
  const requestStart = req.headers['x-request-start'] as string
  if (requestStart) {
    const requestTime = parseInt(requestStart)
    const currentTime = Date.now()
    const maxAge = 5 * 60 * 1000 // 5 minutes in milliseconds

    if (Math.abs(currentTime - requestTime) > maxAge) {
      console.warn(`Railway request timestamp too old: ${requestStart}, current: ${currentTime}`)
      return false
    }

    console.log('Timestamp validation passed using Railway request-start')
    return true
  }

  // Method 3: If no timestamp available, rely on IP validation only
  // This is acceptable since we're already validating TradingView's official IPs
  console.log('No timestamp available, relying on IP validation for replay protection')
  return true
}

// TradingView webhook endpoint
router.post('/alert-hook', (req, res) => {
  // Sanitize request body for logging and storage (remove secret token)
  const webhookSecret = process.env.TRADINGVIEW_WEBHOOK_SECRET
  let sanitizedBody = { ...req.body }

  if (webhookSecret && sanitizedBody.message) {
    console.log('Message contains secret:', sanitizedBody.message.includes(webhookSecret))
    sanitizedBody.message = sanitizedBody.message.replace(webhookSecret, '')
    console.log('Message still contains secret:', sanitizedBody.message.includes(webhookSecret))
  }

  console.log('Received TradingView webhook:', sanitizedBody)

  // Deduplicate identical alerts arriving in a very short window
  const now = Date.now()
  const alertKey = makeAlertKey(sanitizedBody)
  const lastSeen = recentAlerts.get(alertKey)
  const ageMs = typeof lastSeen === 'number' ? now - lastSeen : null
  if (isDuplicateAlert(alertKey, now)) {
    console.warn('[Dedupe] Duplicate alert skipped', {
      ticker: sanitizedBody?.ticker,
      action: sanitizedBody?.strategy?.order?.action,
      prev: sanitizedBody?.strategy?.prev_position,
      current: sanitizedBody?.strategy?.current_position,
      ageMs,
      windowMs: DEDUPE_WINDOW_MS
    })
    res.status(200).json({ success: true, message: 'Duplicate alert skipped', skipped: true })
    return
  }
  rememberAlert(alertKey, now)

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
    message: sanitizedBody.message, // Use the already sanitized message
    timestamp: req.body.timestamp || new Date().toISOString()
  }

  // Validate required fields
  if (!alert.strategy?.order?.action || !alert.ticker || !alert.strategy?.current_position || !alert.strategy?.prev_position) {
    console.warn('Invalid TradingView alert received:', sanitizedBody)
    res.status(400).json({ error: 'Missing required fields: action, ticker, current_position, or prev_position' })
    return
  }

  // Store the alert, then process the trade (skip if exchange disabled)
  storeAlert(alert).then(async () => {
    // Send Telegram receipt alert for every valid TradingView webhook
    try {
      const action = (alert.strategy?.order?.action || '').toUpperCase()
      const curr = (alert.strategy?.current_position || '').toUpperCase()
      const prev = (alert.strategy?.prev_position || '').toUpperCase()
      const tvMsg = alert.message ? `\nMsg: ${alert.message}` : ''
      const ts = alert.timestamp || new Date().toISOString()
      const receipt = `TradingView Webhook Received\nTicker: ${alert.ticker}\nAction: ${action}\nPosition: ${prev} -> ${curr}\nTime: ${ts}${tvMsg}`
      sendAlert(receipt, 'tradingview')
    } catch (notifyErr) {
      console.warn('Failed to send TradingView receipt alert:', notifyErr)
    }

    if (process.env.DISABLE_EXCHANGE === '1') {
      res.status(200).json({
        success: true,
        message: 'Alert received (trading disabled)',
        skipped: true
      })
      return
    }
    // Process the alert based on the action and position changes
    const action = alert.strategy.order.action.toLowerCase()
    const ticker = alert.ticker
    const currentPosition = alert.strategy.current_position.toLowerCase()
    const prevPosition = alert.strategy.prev_position.toLowerCase()

    console.log(`Processing ${action} order for ${ticker} - Position: ${prevPosition} -> ${currentPosition}`)

    try {
      // Execute the trade using our webhook handler
      const tradeResult = await executeTradingViewTrade(action, ticker, currentPosition, prevPosition)

      res.status(200).json({
        success: true,
        message: 'Alert received and trade executed',
        action,
        ticker,
        positionChange: `${prevPosition} -> ${currentPosition}`,
        tradeResult
      })
    } catch (tradeError) {
      console.error('Error executing trade:', tradeError)
      res.status(500).json({
        error: 'Trade execution failed',
        details: tradeError instanceof Error ? tradeError.message : String(tradeError)
      })
    }
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