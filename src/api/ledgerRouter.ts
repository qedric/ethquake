import express from 'express'
import axios from 'axios'
import querystring from 'querystring'
import { getAccountBalance as getKrakenAccountBalance, getKrakenSignature } from '../trading/kraken.js'

const router = express.Router()

// Kraken API credentials
const API_KEY = process.env.KRAKEN_PUBLIC_KEY

// Get position events from Kraken Futures API
// Using the /positions endpoint for position update events
async function getLedgerEntries(params: any = {}) {
  if (!API_KEY) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  
  // Build query parameters
  const queryParams: any = {
    // Filter to show only meaningful position changes
    opened: true,
    closed: true,
    increased: true,
    decreased: true,
    reversed: true,
    no_change: false, // Exclude no-change events
    trades: true,
    funding_realization: false, // Exclude funding events
    settlement: true,
    sort: 'desc', // Most recent first
    count: params.limit || 1000
  }
  
  // Add symbol filter if provided
  if (params.symbol) {
    queryParams.tradeable = params.symbol
    console.log('Filtering by symbol:', params.symbol)
  }
  
  // Add date filters if provided
  if (params.start_date) {
    const startTime = new Date(params.start_date).getTime()
    queryParams.since = startTime
    console.log('Filtering from date:', params.start_date, 'timestamp:', startTime)
  }
  
  if (params.end_date) {
    const endTime = new Date(params.end_date).getTime()
    queryParams.before = endTime
    console.log('Filtering to date:', params.end_date, 'timestamp:', endTime)
  }
  
  const queryString = querystring.stringify(queryParams)
  console.log('Final query parameters:', queryParams)
  console.log('Query string:', queryString)
  
  // Create URL with query parameters
  let url = 'https://futures.kraken.com/api/history/v3/positions'
  if (queryString) {
    url += '?' + queryString
  }
  console.log('Final URL:', url)
  
  // Create signature following the docs pattern
  const path = '/api/history/v3/positions'
  const signature = getKrakenSignature(path, nonce, queryString)

  const config = {
    method: 'GET',
    maxBodyLength: Infinity,
    url: url,
    headers: {
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce,
    },
  }

  try {
    const response = await axios.request(config)

    console.log('Kraken API response data example:', response.data.elements[1])
    
    // Transform position events into ledger format
    const elements = response.data.elements || []
    console.log('Position events found:', elements.length)
    
    const ledgers = elements.map((element: any) => {
      const event = element.event?.PositionUpdate
      if (!event) return null
      
      // Calculate position change
      const oldPos = parseFloat(event.oldPosition || '0')
      const newPos = parseFloat(event.newPosition || '0')
      const positionChange = newPos - oldPos
      
      // Determine event type and description
      let eventType = event.updateReason || 'position_update'
      let description = ''
      let amount: string = '0'
      
      if (event.updateReason === 'trade') {
        if (oldPos === 0 && newPos > 0) {
          eventType = 'position_opened'
          description = `Opened ${newPos.toFixed(5)} ${event.tradeable} position`
        } else if (oldPos > 0 && newPos === 0) {
          eventType = 'position_closed'
          description = `Closed ${oldPos.toFixed(5)} ${event.tradeable} position`
          // For closed positions, amount should be the position size that was closed
          amount = oldPos.toFixed(5)
        } else if (positionChange > 0) {
          eventType = 'position_increased'
          description = `Increased ${event.tradeable} position by ${positionChange.toFixed(5)}`
        } else if (positionChange < 0) {
          eventType = 'position_decreased'
          description = `Decreased ${event.tradeable} position by ${Math.abs(positionChange).toFixed(5)}`
        }
        
        // For non-closed positions, use position change as amount
        if (eventType !== 'position_closed') {
          amount = positionChange.toFixed(5)
        }
      } else if (event.updateReason === 'settlement') {
        eventType = 'settlement'
        description = `Settlement for ${event.tradeable}`
        amount = event.realizedFunding || '0'
      }
      
      return {
        time: Math.floor(element.timestamp / 1000), // Convert from milliseconds to seconds
        type: eventType,
        symbol: event.tradeable,
        description: description || `${event.updateReason || 'Position'} event for ${event.tradeable}`,
        amount: amount,
        balance: parseFloat(event.newPosition || '0').toFixed(5),
        realizedPnL: event.realizedPnL || null,
        fee: event.fee || null,
        feeCurrency: event.feeCurrency || null,
        executionPrice: event.executionPrice || null,
        executionSize: event.executionSize || null
      }
    }).filter(Boolean) // Remove null entries
    
    console.log('Transformed ledgers example:', ledgers[1])
    
    return {
      result: 'success',
      ledgers: ledgers
    }
  } catch (error) {
    console.error('Kraken API Error:', (error as any).response?.data || (error as any).message)
    
    // Return empty data instead of throwing error for now
    console.log('Returning empty ledger data due to API error')
    return {
      result: 'success',
      ledgers: []
    }
  }
}

// Get account balance - using the existing implementation
async function getAccountBalance() {
  try {
    const balance = await getKrakenAccountBalance()
    return {
      result: 'success',
      balance: balance
    }
  } catch (error) {
    console.error('Error getting account balance:', error)
    throw error
  }
}

// Get ledger data with filtering
router.get('/ledger', async (req, res) => {
  console.log('[Ledger API] Received request for ledger data')
  console.log('[Ledger API] Query params:', req.query)
  
  try {
    const { 
      symbol, 
      symbols, 
      start_date, 
      end_date, 
      limit = 1000,
      offset = 0 
    } = req.query

    const params: any = {
      limit: parseInt(limit as string),
      offset: parseInt(offset as string)
    }

    // Parse multi-select symbols (CSV). Backwards compatible with single 'symbol'.
    const parsedSymbols: string[] = (() => {
      if (symbols && typeof symbols === 'string') {
        return symbols.split(',').map(s => s.trim()).filter(Boolean)
      }
      if (symbol && typeof symbol === 'string') {
        return [symbol]
      }
      return []
    })()

    // If exactly one symbol is requested, use upstream API filter for efficiency
    if (parsedSymbols.length === 1) params.symbol = parsedSymbols[0]

    if (start_date) {
      params.start_date = start_date
    }

    if (end_date) {
      params.end_date = end_date
    }

    console.log('[Ledger API] Calling getLedgerEntries with params:', params)
    const ledgerData = await getLedgerEntries(params)
    
    //console.log('[Ledger API] Raw ledger data:', ledgerData)
    
    // Process and categorize the data
    const processedData = {
      entries: [] as Array<{
        time: number
        type: string
        symbol: string
        description: string
        amount: string
        balance: string
        realizedPnL?: string | null
        fee?: string | null
        feeCurrency?: string | null
        executionPrice?: string | null
        executionSize?: string | null
      }>,
      summary: {
        totalPnL: 0,
        totalFees: 0,
        totalCosts: 0,
        tradeCount: 0,
        feeCount: 0
      }
    }

    // Filter by symbols if provided (handles multi-select). If none provided, use all.
    const rawEntries = (ledgerData.ledgers || []) as typeof processedData.entries
    const entries = parsedSymbols.length > 0
      ? rawEntries.filter(e => parsedSymbols.includes(e.symbol))
      : rawEntries

    processedData.entries = entries

    // Calculate summary statistics
    processedData.entries.forEach((entry) => {
      // Calculate PnL from realizedPnL field
      if (entry.realizedPnL) {
        const pnl = parseFloat(entry.realizedPnL)
        processedData.summary.totalPnL += pnl
      }
      
      // Calculate fees from fee field
      if (entry.fee) {
        const fee = parseFloat(entry.fee)
        processedData.summary.totalFees += fee
        processedData.summary.feeCount++
      }
      
      // Count trades (any position change)
      if (entry.type && (entry.type.includes('position_') || entry.type === 'settlement')) {
        processedData.summary.tradeCount++
      }
    })

    res.json(processedData)
  } catch (error) {
    console.error('Error fetching ledger data:', error)
    res.status(500).json({ 
      error: 'Failed to fetch ledger data',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// Get account balance
router.get('/balance', async (req, res) => {
  try {
    const balanceData = await getAccountBalance()
    res.json(balanceData)
  } catch (error) {
    console.error('Error fetching balance data:', error)
    res.status(500).json({ 
      error: 'Failed to fetch balance data',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

// Get available symbols for filtering
router.get('/symbols', async (req, res) => {
  console.log('[Ledger API] Received request for symbols')
  try {
    // Derive symbols from recent ledger entries to reflect actual activity
    const ledgerData = await getLedgerEntries({ limit: 1000 })
    const entries = (ledgerData.ledgers || []) as Array<{ symbol?: string }>
    const symbolsSet = new Set<string>()
    entries.forEach(e => { if (e.symbol) symbolsSet.add(e.symbol) })
    const symbols = Array.from(symbolsSet).sort()
    console.log('[Ledger API] Returning detected symbols:', symbols)
    res.json({ symbols })
  } catch (error) {
    console.error('Error fetching symbols:', error)
    res.status(500).json({ 
      error: 'Failed to fetch symbols',
      details: error instanceof Error ? error.message : String(error)
    })
  }
})

export default router 