import { placeOrderWithExits, getCurrentPrice, calculatePositionSize } from './kraken.js'
//import { sendAlert } from '../alerts/index.js'

// Helper function to round price to 2 decimal places (same as in kraken.ts)
function roundPrice(price: number): number {
  return Math.round(price * 100) / 100
}

const POSITION_SIZE = 0.5 // % of account risked
const FIXED_STOP_DISTANCE = 7 // % fixed stop as safety fallback
const POSITION_SIZE_TYPE = 'risk'

/**
 * Returns the correct position size precision for each trading pair
 * Different instruments have different minimum position size requirements
 */
function getPositionSizePrecision(tradingPair: string): number {
  const precisionMap: { [key: string]: number } = {
    'PF_SUIUSD': 0,  // SUI requires whole numbers
    'PF_SOLUSD': 2,  // SOL uses 2 decimal places
    'PF_ETHUSD': 3,  // ETH uses 3 decimal places
    'PF_BTCUSD': 4,  // BTC uses 4 decimal places
  }
  
  const precision = precisionMap[tradingPair] ?? 2 // Default to 2 decimal places
  console.log(`[getPositionSizePrecision] ${tradingPair} -> ${precision} decimal places`)
  console.log(`[getPositionSizePrecision] Debug - Available keys: ${Object.keys(precisionMap).join(', ')}`)
  console.log(`[getPositionSizePrecision] Debug - Looking for: "${tradingPair}", found: ${Object.prototype.hasOwnProperty.call(precisionMap, tradingPair)}`)
  console.log(`[getPositionSizePrecision] Debug - Direct access: precisionMap["${tradingPair}"] = ${precisionMap[tradingPair]}`)
  console.log(`[getPositionSizePrecision] Debug - Type of value: ${typeof precisionMap[tradingPair]}`)
  return precision
}

/**
 * Executes a trade based on TradingView webhook signal
 * Uses risk-based position sizing with a 7% fixed stop as safety fallback
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

    // Determine the type of position change
    const positionChange = determinePositionChange(trimmedPrevPosition, trimmedCurrentPosition)
    console.log(`[TradingView Webhook] Position change type: ${positionChange} from ${trimmedPrevPosition} to ${trimmedCurrentPosition} based on ${direction} signal`)

    // Skip if this is just a position close (no new position to enter)
    if (positionChange === 'close_only') {
      console.log('[TradingView Webhook] Skipping trade - position close only')
      //sendAlert(`TradingView position close detected for ${ticker}: ${trimmedPrevPosition} -> ${trimmedCurrentPosition}`)
      return {
        success: true,
        direction,
        ticker,
        action: 'position_close',
        positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
        message: 'Position close detected - no new trade needed'
      }
    }

    // Map ticker to Kraken trading pair if needed
    const tradingPair = mapTickerToTradingPair(ticker)
    console.log(`[TradingView Webhook] Mapped ${ticker} to trading pair: ${tradingPair}`)

    // Calculate position size based on risk
    const precision = getPositionSizePrecision(tradingPair)
    console.log(`[TradingView Webhook] Using precision: ${precision} decimal places for ${tradingPair}`)
    console.log(`[TradingView Webhook] Debug - ticker: "${ticker}", tradingPair: "${tradingPair}", precision: ${precision}`)
    console.log(`[TradingView Webhook] About to call calculatePositionSize with precision: ${precision}`)
    
    let calculatedPositionSize = await calculatePositionSize(
      POSITION_SIZE, 
      POSITION_SIZE_TYPE, 
      tradingPair, 
      FIXED_STOP_DISTANCE, 
      precision
    )
    console.log(`[TradingView Webhook] Calculated position size: ${calculatedPositionSize} units`)

    // Validate minimum position size requirements
    const minPositionSizes: { [key: string]: number } = {
      'PF_SUIUSD': 1,    // SUI minimum 1 unit
      'PF_SOLUSD': 0.01, // SOL minimum 0.01 units
      'PF_ETHUSD': 0.001, // ETH minimum 0.001 units
      'PF_BTCUSD': 0.0001, // BTC minimum 0.0001 units
    }
    
    const minSize = minPositionSizes[tradingPair] || 0.01
    if (calculatedPositionSize < minSize) {
      console.log(`[TradingView Webhook] Warning: Calculated position size (${calculatedPositionSize}) is below minimum (${minSize}) for ${tradingPair}`)
      console.log(`[TradingView Webhook] Using minimum position size: ${minSize} units`)
      calculatedPositionSize = minSize
    }
    
    console.log(`[TradingView Webhook] Final position size for ${tradingPair}: ${calculatedPositionSize} units (precision: ${getPositionSizePrecision(tradingPair)} decimal places)`)

    // Calculate the fixed stop price for risk sizing
    const currentPrice = await getCurrentPrice(tradingPair)
    const fixedStopPrice = roundPrice(direction === 'buy'
      ? currentPrice * (1 - FIXED_STOP_DISTANCE / 100) // For buy orders, stop below current price
      : currentPrice * (1 + FIXED_STOP_DISTANCE / 100) // For sell orders, stop above current price
    )

    const fixedStopConfig = {
      type: 'fixed' as const,
      distance: FIXED_STOP_DISTANCE,
      stopPrice: fixedStopPrice
    }

    // Place order with fixed stop (no take profit - rely on TradingView exit webhook)
    const orderResult = await placeOrderWithExits(
      direction, 
      calculatedPositionSize, 
      fixedStopConfig, 
      { type: 'none', price: 0 }, // No take profit
      tradingPair, 
      false, 
      'tradingview_webhook', 
      'fixed', 
      precision
    )

    // Send alert about the trade
    const orderStatus = orderResult?.marketOrder?.result || 'failed'
    //const stopStatus = orderResult?.stopOrder?.sendStatus?.status || 'failed'
    
    //sendAlert(`TradingView ${direction.toUpperCase()} signal for ${ticker}\nPosition Change: ${trimmedPrevPosition} -> ${trimmedCurrentPosition}\nOrder Status: ${orderStatus}\nFixed Stop (7%): ${stopStatus}\nPosition Size: ${calculatedPositionSize} units`)

    console.log(`[TradingView Webhook] Trade execution completed for ${ticker}`)
    return {
      success: orderStatus === 'success',
      direction,
      ticker,
      tradingPair,
      positionSize: calculatedPositionSize,
      positionChange: `${trimmedPrevPosition} -> ${trimmedCurrentPosition}`,
      changeType: positionChange,
      orderResult
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
    'BTCUSD': 'PF_BTCUSD',
    'BTCUSD.PM': 'PF_BTCUSD',
    'BTC/USD': 'PF_BTCUSD',
    'SOLUSD': 'PF_SOLUSD',
    'SOLUSD.PM': 'PF_SOLUSD',
    'SOL/USD': 'PF_SOLUSD',
    'SUIUSD': 'PF_SUIUSD',
    'SUI/USD': 'PF_SUIUSD',
    'SUIUSD.PM' : 'PF_SUIUSD',
  }

  return mappings[tickerUpper] || tickerUpper
}
