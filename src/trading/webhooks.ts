import { placeOrderWithExits, placeStandaloneOrder, getCurrentPrice, calculatePositionSize, cleanupPosition, roundPrice, getPricePrecision, getPositionSizePrecision, getOpenPositions, getOrderStatus } from './kraken.js'
//import { sendAlert } from '../alerts/index.js'

// Per-symbol async lock to serialize webhook processing for each trading pair
const symbolLocks = new Map<string, Promise<void>>()
const symbolResolvers = new Map<string, () => void>()

async function acquireSymbolLock(symbol: string): Promise<() => void> {
  while (symbolLocks.has(symbol)) {
    await symbolLocks.get(symbol)
  }
  let releaseFn: () => void = () => {}
  const lockPromise = new Promise<void>(resolve => {
    releaseFn = resolve
  })
  symbolLocks.set(symbol, lockPromise)
  symbolResolvers.set(symbol, releaseFn)
  return () => {
    const release = symbolResolvers.get(symbol)
    if (release) {
      release()
      symbolResolvers.delete(symbol)
    }
    symbolLocks.delete(symbol)
  }
}

// Verify an order has reached an active placed/trigger state
async function verifyOrderPlaced(orderId: string, isStopOrder: boolean = true): Promise<boolean> {
  const maxAttempts = 3
  const delayMs = 1000
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const status = await getOrderStatus(orderId)
      const validStates = isStopOrder ? ['placed', 'TRIGGER_PLACED'] : ['placed', 'FULLY_EXECUTED']
      if (validStates.includes(status.status)) return true
    } catch (err) {
      // Retry on lookup failure
    }
    await new Promise(res => setTimeout(res, delayMs))
  }
  return false
}

/**
 * Gets the position size percentage for a given symbol
 * Returns the percentage of account to risk based on the instrument
 */
function getPositionSize(symbol: string): number {
  const positionSizes: { [key: string]: number } = {
    'PF_SUIUSD': 3.0,    // SUI - 
    'PF_SOLUSD': 4.0,    // SOL - 
    'PF_WIFUSD': 4.0,    // WIF - 
    'PF_XRPUSD': 2.0,    // XRP - 
    'PF_ETHUSD': 3.0,    // ETH - 
  }
  
  return positionSizes[symbol] || 5.0 // Default to 5% if symbol not found
}

/**
 * Gets the fixed stop distance percentage for a given symbol
 * Returns the percentage stop distance as safety fallback
 */
function getFixedStopDistance(symbol: string): number {
  const stopDistances: { [key: string]: number } = {
    'PF_SUIUSD': 4,
    'PF_SOLUSD': 6,
    'PF_ETHUSD': 2.5,
    'PF_XBTUSD': 5,
    'PF_WIFUSD': 4,
    'PF_XRPUSD': 3,
  }
  
  return stopDistances[symbol] || 7 // Default to 7% if symbol not found
}

/**
 * Gets the position size type for a given symbol
 * Currently all instruments use risk-based sizing
 */
function getPositionSizeType(symbol: string): 'risk' | 'percent' | 'fixed' {
  const positionSizeTypes: { [key: string]: 'risk' | 'percent' | 'fixed' } = {
    'PF_SUIUSD': 'risk',
    'PF_SOLUSD': 'risk',
    'PF_ETHUSD': 'risk',
    'PF_XBTUSD': 'risk',
    'PF_WIFUSD': 'risk',
    'PF_XRPUSD': 'risk'
  }
  return positionSizeTypes[symbol] || 'risk' // All instruments currently use risk-based sizing
}

/**
 * Gets the actual open position for a symbol from the exchange
 * Returns null if no position exists, or the position object if found
 */
async function getActualPosition(symbol: string): Promise<{ side: string, size: number } | null> {
  try {
    const response = await getOpenPositions()
    const positions = response.data.openPositions || []
    const position = positions.find((pos: any) => pos.symbol === symbol)
    
    if (!position) {
      return null
    }
    
    return {
      side: position.side,
      size: position.size
    }
  } catch (error) {
    console.error('Error getting actual position:', error)
    return null
  }
}

/**
 * Executes a trade based on TradingView webhook signal
 * Uses risk-based position sizing with dynamic fixed stops per instrument
 * Handles position changes intelligently based on current and previous positions
 */
export async function executeTradingViewTrade(
  action: string, 
  ticker: string, 
  currentPosition: string, 
  prevPosition: string
): Promise<any> {
  try {
    console.log(`[TradingView Webhook] Position change: ${prevPosition} -> ${currentPosition}`)

    // Validate action
    const direction = action.toLowerCase()
    if (direction !== 'buy' && direction !== 'sell') {
      throw new Error(`Invalid action: ${action}. Must be 'buy' or 'sell'`)
    }

    // Validate positions
    const validPositions = ['long', 'short', 'flat']
    const trimmedCurrentPosition = currentPosition.trim()
    const trimmedPrevPosition = prevPosition.trim()
    
    if (!validPositions.includes(trimmedCurrentPosition) || !validPositions.includes(trimmedPrevPosition)) {
      throw new Error(`Invalid position values: current=${currentPosition}, prev=${prevPosition}. Must be 'long', 'short', or 'flat'`)
    }

    // Map ticker to Kraken trading pair and acquire per-symbol lock
    const tradingPair = mapTickerToTradingPair(ticker)
    console.log(`[TradingView Webhook] Mapped ${ticker} to trading pair: ${tradingPair}`)
    const releaseLock = await acquireSymbolLock(tradingPair)
    try {
      // Reconcile with actual exchange position to avoid misclassification
      let effectivePrevPosition = trimmedPrevPosition
      try {
        const actual = await getActualPosition(tradingPair)
        if (actual) {
          if (actual.side !== trimmedPrevPosition) {
            console.warn(`[TradingView Webhook] Correcting prev position from ${trimmedPrevPosition} to ${actual.side} based on exchange state`)
            effectivePrevPosition = actual.side
          }
        } else if (trimmedPrevPosition !== 'flat') {
          console.warn(`[TradingView Webhook] No actual position found but prev reported as ${trimmedPrevPosition}. Treating prev as flat`)
          effectivePrevPosition = 'flat'
        }
      } catch (posErr) {
        console.warn('[TradingView Webhook] Failed to get actual position, proceeding with webhook positions:', posErr)
      }

      // Determine the type of position change using reconciled prev
      const positionChange = determinePositionChange(effectivePrevPosition, trimmedCurrentPosition)
      console.log(`[TradingView Webhook] Position change type: ${positionChange} from ${effectivePrevPosition} to ${trimmedCurrentPosition} based on ${direction} signal`)

      // Handle reverse position changes - close existing position first
      if (positionChange === 'reverse_position') {
        console.log(`[TradingView Webhook] Reverse position detected - closing existing ${trimmedPrevPosition} position first`)
        
        // Validate that the actual position matches what we expect to close
        const actualPosition = await getActualPosition(tradingPair)
        if (actualPosition && actualPosition.side !== trimmedPrevPosition) {
          console.warn(`[TradingView Webhook] Position mismatch! Expected ${trimmedPrevPosition} but found ${actualPosition.side} position for ${ticker}`)
          throw new Error(`Position mismatch: expected ${trimmedPrevPosition} but found ${actualPosition.side} position for ${ticker}`)
        }
        
        // Close the existing position
        const closeResult = await cleanupPosition(tradingPair, 'tradingview_webhook')
        if (!closeResult) {
          throw new Error(`Failed to close existing ${trimmedPrevPosition} position for ${ticker}`)
        }
        
        console.log(`[TradingView Webhook] Successfully closed existing position for ${ticker}`)
        //sendAlert(`TradingView position reverse for ${ticker}: Closed ${trimmedPrevPosition} position`)
      }

      // Handle position close - actually close the existing position
      if (positionChange === 'close_only') {
        console.log(`[TradingView Webhook] Position close detected - closing existing ${trimmedPrevPosition} position`)
        
        // Validate that the actual position matches what we expect to close
        const actualPosition = await getActualPosition(tradingPair)
        if (actualPosition && actualPosition.side !== trimmedPrevPosition) {
          console.warn(`[TradingView Webhook] Position mismatch! Expected ${trimmedPrevPosition} but found ${actualPosition.side} position for ${ticker}`)
          return {
            success: false,
            direction,
            ticker,
            action: 'position_close',
            positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
            message: `Position mismatch: expected ${trimmedPrevPosition} but found ${actualPosition.side}`,
            error: 'position_mismatch'
          }
        }
        
        // Close the existing position
        const closeResult = await cleanupPosition(tradingPair, 'tradingview_webhook')
        if (!closeResult) {
          console.log(`[TradingView Webhook] No current position found for ${ticker} - nothing to close`)
          return {
            success: true,
            direction,
            ticker,
            action: 'position_close',
            positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
            message: 'No current position found - nothing to close'
          }
        }
        
        console.log(`[TradingView Webhook] Successfully closed ${trimmedPrevPosition} position for ${ticker}`)
        //sendAlert(`TradingView position close for ${ticker}: Closed ${trimmedPrevPosition} position`)
        
        return {
          success: true,
          direction,
          ticker,
          action: 'position_close',
          positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
          message: 'Position successfully closed',
          positionClosed: trimmedPrevPosition
        }
      }

      // Calculate position size based on risk
      const precision = getPositionSizePrecision(tradingPair)
    
      let calculatedPositionSize = await calculatePositionSize(
        getPositionSize(tradingPair), 
        getPositionSizeType(tradingPair), 
        tradingPair, 
        getFixedStopDistance(tradingPair), 
        precision
      )
      console.log(`[TradingView Webhook] Calculated position size: ${calculatedPositionSize} units`)

    // Validate minimum position size requirements
    const minPositionSizes: { [key: string]: number } = {
      'PF_SUIUSD': 1,    // SUI minimum 1 unit
      'PF_SOLUSD': 0.01, // SOL minimum 0.01 units
      'PF_ETHUSD': 0.001, // ETH minimum 0.001 units
      'PF_BTCUSD': 0.0001, // BTC minimum 0.0001 units
      'PF_WIFUSD': 1, // WIF minimum 0.0001 units
    }

    // Maximum position size for safety
    const maxPositionSizes: { [key: string]: number } = {
      'PF_SUIUSD': 2000,    // SUI minimum 1 unit
      'PF_SOLUSD': 30, // SOL minimum 0.01 units
      'PF_ETHUSD': 3, // ETH minimum 0.001 units
      'PF_BTCUSD': 0.06, // BTC minimum 0.0001 units
      'PF_WIFUSD': 4000, // WIF minimum 0.0001 units
    }
    
      const minSize = minPositionSizes[tradingPair] || 0.01
      if (calculatedPositionSize < minSize) {
        console.log(`[TradingView Webhook] Warning: Calculated position size (${calculatedPositionSize}) is below minimum (${minSize}) for ${tradingPair}`)
        console.log(`[TradingView Webhook] Using minimum position size: ${minSize} units`)
        calculatedPositionSize = minSize
      }
    
      const maxSize = maxPositionSizes[tradingPair]
      if (calculatedPositionSize > maxSize) {
        console.log(`[TradingView Webhook] Warning: Calculated position size (${calculatedPositionSize}) is above maximum (${maxSize}) for ${tradingPair}`)
        console.log(`[TradingView Webhook] Using maximum position size: ${maxSize} units`)
        calculatedPositionSize = maxSize
      }

    // Calculate the fixed stop price for risk sizing
      const currentPrice = await getCurrentPrice(tradingPair)
      const fixedStopDistance = getFixedStopDistance(tradingPair)
      const fixedStopPrice = roundPrice(direction === 'buy'
        ? currentPrice * (1 - fixedStopDistance / 100)
        : currentPrice * (1 + fixedStopDistance / 100)
      , getPricePrecision(tradingPair))

      console.log(`[TradingView Webhook] Current price: ${currentPrice}, Fixed stop price: ${fixedStopPrice}`)

    // First, place the fixed stop for risk protection
      console.log(`[TradingView Webhook] Placing fixed stop for risk protection at ${fixedStopDistance}%`)
      let fixedStopResult = null
      let marketOrderResult = null
    
    try {
        fixedStopResult = await placeStandaloneOrder(
          'stp',
          direction === 'buy' ? 'sell' : 'buy',
          calculatedPositionSize,
          tradingPair,
          { stopPrice: fixedStopPrice },
          true
        )

      if (fixedStopResult?.result === 'success') {
        const stopOrderId = fixedStopResult?.sendStatus?.order_id
        if (!stopOrderId) {
          throw new Error('Fixed stop did not return an order_id')
        }
        const verified = await verifyOrderPlaced(stopOrderId, true)
        if (!verified) {
          throw new Error('Failed to verify fixed stop order placement')
        }
        console.log(`[TradingView Webhook] Fixed stop placed successfully at ${fixedStopPrice}`)
      } else {
        console.error('[TradingView Webhook] Failed to place fixed stop:', fixedStopResult?.error)
        // Don't proceed with market order if fixed stop fails
        throw new Error('Failed to place fixed stop')
      }
    } catch (fixedStopError) {
      console.error('[TradingView Webhook] Error placing fixed stop:', fixedStopError)
      throw new Error('Failed to place fixed stop')
    }

    // If fixed stop was successful, place market order
    console.log('[TradingView Webhook] Fixed stop successful, placing market order')
    
    try {
        marketOrderResult = await placeOrderWithExits(
          direction, 
          calculatedPositionSize, 
          { type: 'none', distance: 0 },
          { type: 'none', price: 0 },
          tradingPair, 
          false, 
          'tradingview_webhook', 
          'fixed', 
          precision
        )
    } catch (marketOrderError) {
      console.error('[TradingView Webhook] Error placing market order:', marketOrderError)
      throw new Error('Failed to place market order')
    }

    // Send alert about the trade
      const orderStatus = marketOrderResult?.marketOrder?.result || 'failed'
      const stopStatus = fixedStopResult?.sendStatus?.status || 'failed'
      
      const alertMessage = positionChange === 'reverse_position' 
        ? `TradingView ${direction.toUpperCase()} signal for ${ticker}\nPosition Change: ${trimmedPrevPosition} -> ${trimmedCurrentPosition} (REVERSED)\nOrder Status: ${orderStatus}\nFixed Stop (${fixedStopDistance}%): ${stopStatus}\nPosition Size: ${calculatedPositionSize} units`
        : `TradingView ${direction.toUpperCase()} signal for ${ticker}\nPosition Change: ${trimmedPrevPosition} -> ${trimmedCurrentPosition}\nOrder Status: ${orderStatus}\nFixed Stop (${fixedStopDistance}%): ${stopStatus}\nPosition Size: ${calculatedPositionSize} units`

    console.log('alertMessage', alertMessage)
    
    //sendAlert(alertMessage)

      console.log(`[TradingView Webhook] Trade execution completed for ${ticker}`)
      return {
        success: orderStatus === 'success',
        direction,
        ticker,
        tradingPair,
        positionSize: calculatedPositionSize,
        positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
        changeType: positionChange,
        marketOrderResult,
        fixedStopResult,
        positionClosed: positionChange === 'reverse_position' ? trimmedPrevPosition : null
      }
    } finally {
      // Always release the per-symbol lock
      releaseLock()
    }

  } catch (error) {
    console.error('[TradingView Webhook] Error executing trade:', error)
    //sendAlert(`TradingView webhook trade failed for ${ticker}: ${error instanceof Error ? error.message : String(error)}`)
    throw error
  }
}

/**
 * Determines the type of position change based on previous and current positions
 * Returns: 'new_position', 'reverse_position', 'close_only', or 'no_change'
 */
function determinePositionChange(prevPosition: string, currentPosition: string): string {
  // No change in position
  if (prevPosition === currentPosition) {
    return 'no_change'
  }

  // Position close (going to flat)
  if (currentPosition === 'flat') {
    return 'close_only'
  }

  // New position (from flat to long/short)
  if (prevPosition === 'flat') {
    return 'new_position'
  }

  // Reverse position (long to short or short to long)
  if ((prevPosition === 'long' && currentPosition === 'short') || 
      (prevPosition === 'short' && currentPosition === 'long')) {
    return 'reverse_position'
  }

  // Shouldn't reach here, but just in case
  return 'unknown'
}

/**
 * Maps common ticker symbols to Kraken trading pairs
 */
function mapTickerToTradingPair(ticker: string): string {
  const tickerUpper = ticker.toUpperCase()
  
  // Common mappings
  const mappings: { [key: string]: string } = {
    'ETHUSD': 'PF_ETHUSD',
    'ETHUSD.PM': 'PF_ETHUSD',
    'ETH/USD': 'PF_ETHUSD',
    'BTCUSD': 'PF_XBTUSD',
    'BTCUSD.PM': 'PF_XBTUSD',
    'BTC/USD': 'PF_XBTUSD',
    'SOLUSD': 'PF_SOLUSD',
    'SOLUSD.PM': 'PF_SOLUSD',
    'SOL/USD': 'PF_SOLUSD',
    'SUIUSD': 'PF_SUIUSD',
    'SUI/USD': 'PF_SUIUSD',
    'SUIUSD.PM' : 'PF_SUIUSD',
    'WIFUSD': 'PF_WIFUSD',
    'WIF/USD': 'PF_WIFUSD',
    'WIFUSD.PM': 'PF_WIFUSD',
    'XRPUSD': 'PF_XRPUSD',
    'XRP/USD': 'PF_XRPUSD',
    'XRPUSD.PM': 'PF_XRPUSD'
  }

  return mappings[tickerUpper] || tickerUpper
}