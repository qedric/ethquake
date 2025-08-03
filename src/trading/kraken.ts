import crypto from 'crypto'
import axios from 'axios'
import dotenv from 'dotenv'
import querystring from 'querystring'
import { Position, createPosition, updateOrderStatus, closePosition, updatePosition, getPosition } from './positions.js'

dotenv.config()

// Kraken API credentials
const API_KEY = process.env.KRAKEN_PUBLIC_KEY
const API_SECRET = process.env.KRAKEN_PRIVATE_KEY

// Function to get Kraken signature
/**
*
* @param {string} urlPath
* @param {string} nonce
* @param {string} data
*/
function getKrakenSignature(urlPath: string, nonce: string, data: string) {
  const encoded = data + nonce + urlPath
  const sha256Hash = crypto.createHash('sha256').update(encoded).digest()
  const secretBuffer = Buffer.from(API_SECRET || '', 'base64')
  const hmac = crypto.createHmac('sha512', secretBuffer).update(sha256Hash)
  const signature = hmac.digest('base64')
  return signature
}

async function sendOrder(payload: any) {

  const BaseURL = 'https://futures.kraken.com'
  const nonce = Date.now().toString()
  const payloadString = querystring.stringify(payload)

  const signature = getKrakenSignature('/api/v3/sendorder', nonce, payloadString)

  let config = {
    method: 'POST',
    maxBodyLength: Infinity,
    url: BaseURL + '/derivatives/api/v3/sendorder',
    headers: {
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce,
    },
    data: payloadString,
  }

  try {
    return await axios.request(config)
  } catch (error) {
    console.error('API Error:', (error as any).response?.data || (error as any).message)
    throw error
  }
}

type StopType = 'none' | 'fixed' | 'trailing'

interface BaseStopConfig {
  type: StopType
  distance: number // percentage
}

interface NoStopConfig extends BaseStopConfig {
  type: 'none'
}

interface TrailingStopConfig extends BaseStopConfig {
  type: 'trailing'
}

interface FixedStopConfig extends BaseStopConfig {
  type: 'fixed'
  stopPrice: number
}

type StopConfig = NoStopConfig | TrailingStopConfig | FixedStopConfig

type TakeProfitType = 'none' | 'limit'

interface BaseTakeProfitConfig {
  type: TakeProfitType
  price: number
}

interface NoTakeProfitConfig extends BaseTakeProfitConfig {
  type: 'none'
}

interface LimitTakeProfitConfig extends BaseTakeProfitConfig {
  type: 'limit'
}

type TakeProfitConfig = NoTakeProfitConfig | LimitTakeProfitConfig

/**
 * Returns the correct position size precision for each trading pair
 * Different instruments have different minimum position size requirements
 */
export function getPositionSizePrecision(tradingPair: string): number {
  const precisionMap: { [key: string]: number } = {
    'PF_SUIUSD': 0,  // SUI requires whole numbers
    'PF_SOLUSD': 2,  // SOL uses 2 decimal places
    'PF_ETHUSD': 3,  // ETH uses 3 decimal places
    'PF_BTCUSD': 4,  // BTC uses 4 decimal places
    'PF_WIFUSD': 0,  // WIF uses 0 decimal places
  }
  
  return precisionMap[tradingPair] ?? 2 // Default to 2 decimal places
}

/**
 * Returns the correct price precision for each trading pair
 * Different instruments have different price precision requirements
 */
export function getPricePrecision(tradingPair: string): number {
  const precisionMap: { [key: string]: number } = {
    'PF_SUIUSD': 4,  // SUI uses 4 decimal place
    'PF_SOLUSD': 2,  // SOL uses 2 decimal places
    'PF_ETHUSD': 1,  // ETH uses 1 decimal place
    'PF_BTCUSD': 0,  // BTC uses 0 decimal place
    'PF_WIFUSD': 4,  // WIF uses 0 decimal place
  }
  
  return precisionMap[tradingPair] ?? 2 // Default to 2 decimal places
}

/**
 * Rounds a price to the specified precision
 */
export function roundPrice(price: number, precision: number = 2): number {
  return Math.round(price * Math.pow(10, precision)) / Math.pow(10, precision)
}

/**
 * Gets the current price for a symbol
 */
export async function getCurrentPrice(symbol: string): Promise<number> {
  try {
    const response = await axios.get('https://futures.kraken.com/derivatives/api/v3/tickers')
    const ticker = response.data.tickers.find((t: any) => t.symbol === symbol)
    if (!ticker) {
      throw new Error(`No ticker found for symbol ${symbol}`)
    }
    return parseFloat(ticker.markPrice)
  } catch (error) {
    console.error('Error getting current price:', error)
    throw error
  }
}

/**
 * Gets the account balance/portfolio value
 */
export async function getAccountBalance(): Promise<number> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  const payload = {}
  const data = querystring.stringify(payload)
  const signature = getKrakenSignature('/api/v3/accounts', nonce, data)

  let config = {
    method: 'GET',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/accounts',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce
    }
  }

  try {
    const response = await axios.request(config)
    if (response.data.result === 'success' && response.data.accounts) {
      // Look for the multiCollateralMarginAccount which contains the portfolio value
      const accounts = response.data.accounts as Record<string, any>
      
      // Find the multiCollateralMarginAccount (usually named 'flex')
      for (const [, account] of Object.entries(accounts)) {
        if (account.type === 'multiCollateralMarginAccount') {
          return parseFloat(account.portfolioValue || '0')
        }
      }
      
      // Fallback: if no multiCollateralMarginAccount found, try to find any account with portfolioValue
      for (const [, account] of Object.entries(accounts)) {
        if (account.portfolioValue) {
          return parseFloat(account.portfolioValue)
        }
      }
      
      throw new Error('No multiCollateralMarginAccount found in response')
    }
    throw new Error('Failed to get account balance')
  } catch (error) {
    console.error('Error getting account balance:', error)
    throw error
  }
}

/**
 * Calculates position size based on type (fixed, percentage, or risk)
 */
export async function calculatePositionSize(
  positionSize: number,
  positionSizeType: 'percent' | 'fixed' | 'risk' = 'fixed',
  symbol: string,
  stopDistance?: number, // Required for risk-based sizing
  precision?: number // Decimal places for rounding
): Promise<number> {
  if (positionSizeType === 'fixed') {
    return positionSize
  }

  if (positionSizeType === 'percent') {
    const accountBalance = await getAccountBalance()
    const currentPrice = await getCurrentPrice(symbol)
    
    // Calculate position size as percentage of portfolio value
    const portfolioValue = accountBalance * (positionSize / 100)
    const positionSizeInUnits = portfolioValue / currentPrice
    
    // Round to specified precision or use default
    const precisionToUse = precision !== undefined ? precision : 2 // Default to 2 decimal places
    return Math.round(positionSizeInUnits * Math.pow(10, precisionToUse)) / Math.pow(10, precisionToUse)
  }

  if (positionSizeType === 'risk') {
    if (stopDistance === undefined || stopDistance <= 0) {
      throw new Error('Stop distance is required for risk-based position sizing')
    }
    
    const accountBalance = await getAccountBalance()
    const currentPrice = await getCurrentPrice(symbol)
    
    // Calculate position size based on risk
    // If we want to risk X% of account and stop is Y% away, then:
    // Risk Amount = Account Balance * (X / 100)
    // Position Size = Risk Amount / (Current Price * Y / 100)
    const riskAmount = accountBalance * (positionSize / 100)
    const stopDistanceInPrice = currentPrice * (stopDistance / 100)
    const positionSizeInUnits = riskAmount / stopDistanceInPrice
    
    // Round to specified precision or use default
    const precisionToUse = precision !== undefined ? precision : 2 // Default to 2 decimal places

    let calculatedSize = Math.round(positionSizeInUnits * Math.pow(10, precisionToUse)) / Math.pow(10, precisionToUse)
    console.log(`[Symbol: ${symbol}] Calculated position size: ${calculatedSize} units`)
    // temp protection until we've confirmed the position size calculation is working
    if (symbol === 'PF_XBTUSD' && calculatedSize > 0.02) {
      console.log(`[Strategy: ethquake] Calculated position size is too large: ${calculatedSize} units`)
      calculatedSize = 0.02
    } else if (symbol === 'PF_ETHUSD' && calculatedSize > 2.5) {
      console.log(`[Strategy: ethquake] Calculated position size is too large: ${calculatedSize} units`)
      calculatedSize = 2.5
    } else if (symbol === 'PF_SOLUSD' && calculatedSize > 10) {
      console.log(`[Strategy: ethquake] Calculated position size is too large: ${calculatedSize} units`)
      calculatedSize = 10
    }

    return calculatedSize
  }

  throw new Error(`Invalid position size type: ${positionSizeType}`)
}

const MAX_VERIFICATION_ATTEMPTS = 3
const VERIFICATION_DELAY_MS = 1000
const INITIAL_VERIFICATION_DELAY_MS = 3000

/**
 * Verifies that an order exists and is in the expected state
 */
async function verifyOrder(orderId: string, expectedStatus: string = 'placed', isStopOrder: boolean = false): Promise<boolean> {
  // Wait initially to allow the order to be processed
  console.log(`Waiting ${INITIAL_VERIFICATION_DELAY_MS}ms for order ${orderId} to settle...`)
  await new Promise(resolve => setTimeout(resolve, INITIAL_VERIFICATION_DELAY_MS))
  
  let attempts = 0
  while (attempts < MAX_VERIFICATION_ATTEMPTS) {
    try {
      const orderStatus = await getOrderStatus(orderId)
      // For stop orders, TRIGGER_PLACED is a valid state
      const validStates = isStopOrder 
        ? [expectedStatus, 'TRIGGER_PLACED'] 
        : [expectedStatus, 'FULLY_EXECUTED']
      
      if (validStates.includes(orderStatus.status)) {
        return true
      }
      console.log(`Order ${orderId} status: ${orderStatus.status}, expected one of: ${validStates.join(', ')}. Attempt ${attempts + 1}/${MAX_VERIFICATION_ATTEMPTS}`)
      await new Promise(resolve => setTimeout(resolve, VERIFICATION_DELAY_MS))
      attempts++
    } catch (error) {
      if ((error as any).response?.data?.error?.includes('Order not found')) {
        console.log(`Order ${orderId} not found yet. Attempt ${attempts + 1}/${MAX_VERIFICATION_ATTEMPTS}`)
      } else {
        console.error(`Error verifying order ${orderId}:`, error)
      }
      await new Promise(resolve => setTimeout(resolve, VERIFICATION_DELAY_MS))
      attempts++
    }
  }
  return false
}

/**
 * Verifies that an order has been cancelled
 */
async function verifyOrderCancelled(orderId: string): Promise<boolean> {
  let attempts = 0
  while (attempts < MAX_VERIFICATION_ATTEMPTS) {
    try {
      const orderStatus = await getOrderStatus(orderId)
      if (orderStatus.status.toLowerCase() === 'cancelled') {
        return true
      }
      console.log(`Order ${orderId} status: ${orderStatus.status}, expected: cancelled. Attempt ${attempts + 1}/${MAX_VERIFICATION_ATTEMPTS}`)
      await new Promise(resolve => setTimeout(resolve, VERIFICATION_DELAY_MS))
      attempts++
    } catch (error) {
      // If we can't find the order, it might have been cancelled
      if ((error as any).response?.data?.error?.includes('Order not found')) {
        return true
      }
      console.error(`Error verifying order cancellation ${orderId}:`, error)
      attempts++
    }
  }
  return false
}

/**
 * Safely replaces one order with another
 */
export async function replaceOrder(
  oldOrderId: string,
  side: 'buy' | 'sell',
  size: number,
  stopConfig: StopConfig,
  takeProfitConfig: TakeProfitConfig,
  symbol: string,
  isStopOrder: boolean = true // true for stop orders, false for take profit
): Promise<{ success: boolean, newOrderId: string | null }> {
  try {
    
    // For replacing orders, we always use the existing position size
    // This avoids recalculating position size which could lead to mismatches
    let actualPositionSize: number
    try {
      const response = await getOpenPositions()
      const positions = response.data.openPositions || []
      const position = positions.find((pos: any) => pos.symbol === symbol)
      if (position) {
        actualPositionSize = position.size
        console.log(`Using existing position size for order replacement: ${actualPositionSize}`)
      } else {
        throw new Error('No open position found for order replacement')
      }
    } catch (error) {
      console.error('Error getting position size for order replacement:', error)
      throw new Error('Failed to get existing position size for order replacement')
    }
    
    // Create the appropriate order data based on type
    const orderData = isStopOrder && stopConfig.type === 'trailing' ? {
      orderType: 'trailing_stop',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: actualPositionSize,
      trailingStopDeviationUnit: 'PERCENT',
      trailingStopMaxDeviation: stopConfig.distance,
      reduceOnly: true,
      triggerSignal: 'mark'
    } : isStopOrder && stopConfig.type === 'fixed' ? {
      orderType: 'stp',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: actualPositionSize,
      stopPrice: roundPrice((stopConfig as FixedStopConfig).stopPrice, getPricePrecision(symbol)),
      reduceOnly: true,
      triggerSignal: 'mark'
    } : !isStopOrder && takeProfitConfig.type === 'limit' ? {
      orderType: 'take_profit',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: actualPositionSize,
      stopPrice: roundPrice(takeProfitConfig.price, getPricePrecision(symbol)),
      reduceOnly: true,
      triggerSignal: 'mark'
    } : null

    if (!orderData) {
      throw new Error('Invalid order configuration')
    }

    // Place the new order directly
    const result = await sendOrder(orderData)
    console.log('New order result:', result.data)

    if (result.data.result !== 'success' || !result.data.sendStatus?.order_id) {
      throw new Error(`Failed to place new ${isStopOrder ? 'stop' : 'take profit'} order`)
    }

    // Verify the new order is active
    const newOrderId = result.data.sendStatus.order_id
    const newOrderVerified = await verifyOrder(newOrderId, 'placed', true)
    if (!newOrderVerified) {
      throw new Error(`Failed to verify new ${isStopOrder ? 'stop' : 'take profit'} order`)
    }

    // Now cancel the old order
    const cancelResult = await cancelOrder(oldOrderId)
    if (cancelResult.result !== 'success') {
      throw new Error(`Failed to cancel old ${isStopOrder ? 'stop' : 'take profit'} order`)
    }

    // Verify the old order is cancelled
    const oldOrderCancelled = await verifyOrderCancelled(oldOrderId)
    if (!oldOrderCancelled) {
      throw new Error(`Failed to verify old ${isStopOrder ? 'stop' : 'take profit'} order cancellation`)
    }

    return { success: true, newOrderId }
  } catch (error) {
    console.error(`Error replacing ${isStopOrder ? 'stop' : 'take profit'} order:`, error)
    return { success: false, newOrderId: null }
  }
}

interface OrderResponse {
  marketOrder: {
    result: string
    sendStatus: {
      order_id: string
      status: string
      positionId?: string // Some exchanges return position ID with the order
    }
  } | null
  stopOrder: {
    result: string
    sendStatus: {
      order_id: string
      status: string
    }
  } | null
  takeProfitOrder: {
    result: string
    sendStatus: {
      order_id: string
      status: string
    }
  } | null
  status?: string
  error?: string
  orderIds: string[]  // Track all orders created
  positionId?: string // MongoDB position document ID
}

/**
 * Places an order on Kraken Futures with verification
 */
export async function placeOrderWithExits(
  side: 'buy' | 'sell',
  size: number,
  stopConfig: StopConfig = { type: 'none', distance: 0 },
  takeProfitConfig: TakeProfitConfig = { type: 'none', price: 0 },
  symbol: string,
  reduceOnly: boolean = false,
  strategyId?: string, // Added strategyId parameter
  positionSizeType: 'percent' | 'fixed' | 'risk' = 'fixed', // Added position size type parameter
  precision?: number, // Decimal places for position size rounding
  noDB: boolean = false // If true, skip all DB logic
): Promise<OrderResponse> {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  let marketOrderId: string | null = null
  let stopOrderId: string | null = null
  let takeProfitOrderId: string | null = null
  let orderIds: string[] = []  // Track all orders created in this operation
  let positionId: string | undefined // Track MongoDB position ID

  try {
    // Get current price for entry
    const currentPrice = await getCurrentPrice(symbol)
    
    // Determine the position size to use
    let finalSize: number
    
    if (reduceOnly) {
      // For closing positions (reduceOnly: true), use the actual position size from the exchange
      try {
        const response = await getOpenPositions()
        const positions = response.data.openPositions || []
        const position = positions.find((pos: any) => pos.symbol === symbol)
        if (position) {
          finalSize = position.size
          console.log(`Using existing position size for closing order: ${finalSize}`)
        } else {
          throw new Error('No open position found for closing order')
        }
      } catch (error) {
        console.error('Error getting position size for closing order:', error)
        throw new Error('Failed to get existing position size for closing order')
      }
    } else {
      // For opening positions (reduceOnly: false), calculate the position size based on type
      let stopDistance: number | undefined
      if (positionSizeType === 'risk' && stopConfig.type !== 'none') {
        if (stopConfig.type === 'trailing') {
          // For trailing stops, use the trailing distance as the stop distance
          stopDistance = stopConfig.distance
        } else if (stopConfig.type === 'fixed') {
          // For fixed stops, calculate the distance from current price to stop price
          const priceDistance = Math.abs(currentPrice - stopConfig.stopPrice)
          stopDistance = (priceDistance / currentPrice) * 100
        }
      }
      
      finalSize = await calculatePositionSize(
        size, 
        positionSizeType, 
        symbol,
        stopDistance,
        precision
      )
    }

    // Create the market order data
    const marketOrderData = {
      orderType: 'mkt',
      symbol: symbol,
      size: finalSize,
      side: side.toLowerCase(),
      reduceOnly  // Use the passed reduceOnly parameter for market orders
    }

    // Create the stop order data if needed
    const stopOrderData = stopConfig.type === 'trailing' ? {
      orderType: 'trailing_stop',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: finalSize,
      trailingStopDeviationUnit: 'PERCENT',
      trailingStopMaxDeviation: stopConfig.distance,
      reduceOnly: true,  // Always true for stop orders to prevent position stacking
      triggerSignal: 'mark'
    } : stopConfig.type === 'fixed' ? {
      orderType: 'stp',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: finalSize,
      stopPrice: roundPrice(stopConfig.stopPrice, getPricePrecision(symbol)),
      reduceOnly: true,  // Always true for stop orders to prevent position stacking
      triggerSignal: 'mark'
    } : null

    // Create the take profit order data if needed
    const takeProfitOrderData = takeProfitConfig.type === 'limit' ? {
      orderType: 'take_profit',
      symbol: symbol,
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: finalSize,
      stopPrice: roundPrice(takeProfitConfig.price, getPricePrecision(symbol)),
      reduceOnly: true,  // Always true for take profit orders to prevent position stacking
      triggerSignal: 'mark'
    } : null

    const marketOrderResult = await sendOrder(marketOrderData)
    console.log('marketOrderResult:', marketOrderResult.data)

    if (marketOrderResult.data.result === 'success') {
      // Store the market order ID for potential cleanup
      marketOrderId = marketOrderResult.data.sendStatus?.order_id || null
      if (marketOrderId) orderIds.push(marketOrderId)

      // Create position record if this is an opening trade (not reduceOnly)
      if (!reduceOnly && strategyId && marketOrderId && !noDB) {  // Add null check for marketOrderId
        const position: Omit<Position, '_id'> = {
          strategyId,
          symbol,
          side: side === 'buy' ? 'long' : 'short',
          size: finalSize,
          status: 'open',
          entryPrice: currentPrice,
          openedAt: new Date(),
          orders: {
            entry: {
              orderId: marketOrderId,
              status: 'PLACED',
              price: currentPrice,
              timestamp: new Date()
            }
          }
        }

        positionId = await createPosition(position)
      }

      // Verify market order
      if (marketOrderId) {
        const marketOrderVerified = await verifyOrder(marketOrderId, 'placed', false)
        if (!marketOrderVerified) {
          // If verification fails, try to cancel the order
          if (marketOrderId) {
            console.log(`Verification failed for market order ${marketOrderId}, attempting to cancel...`)
            try {
              await cancelOrder(marketOrderId)
              console.log(`Successfully cancelled market order ${marketOrderId}`)
            } catch (cancelError) {
              console.error(`Failed to cancel market order ${marketOrderId}:`, cancelError)
            }
          }
          throw new Error('Failed to verify market order execution')
        }

        // Update position with executed market order status
        if (positionId && !noDB) {
          await updateOrderStatus(positionId, 'entry', 'FULLY_EXECUTED')
        }
      }

      let stopOrderResult = null
      if (stopConfig.type !== 'none' && stopOrderData) {
        stopOrderResult = await sendOrder(stopOrderData)
        console.log('stopOrderResult:', stopOrderResult.data)

        // Store the stop order ID for potential cleanup
        stopOrderId = stopOrderResult.data.sendStatus?.order_id || null
        if (stopOrderId) {
          orderIds.push(stopOrderId)
          
          // Update position with stop order if we're tracking it
          if (positionId && !noDB) {
            const position = await getPosition(positionId)
            if (position) {
              await updatePosition(positionId, {
                orders: {
                  ...position.orders,
                  stopLoss: {
                    orderId: stopOrderId,
                    status: 'PLACED',
                    price: stopConfig.type === 'fixed' ? stopConfig.stopPrice : 0,
                    type: stopConfig.type,
                    distance: stopConfig.distance,
                    timestamp: new Date()
                  }
                }
              })
            }
          }
        }

        // Verify stop order
        if (stopOrderId) {
          const stopOrderVerified = await verifyOrder(stopOrderId, 'placed', true)
          if (!stopOrderVerified) {
            // If stop verification fails, cancel both orders
            console.log(`Verification failed for stop order ${stopOrderId}, cleaning up orders...`)
            try {
              // Only cancel orders we created
              for (const id of orderIds) {
                await cancelOrder(id)
              }
              console.log('Successfully cancelled all orders')
            } catch (cancelError) {
              console.error('Failed to cancel orders during cleanup:', cancelError)
            }
            throw new Error('Failed to verify stop order placement')
          }

          // Update position with verified stop order status
          if (positionId && !noDB) {
            await updateOrderStatus(positionId, 'stopLoss', 'TRIGGER_PLACED')
          }
        }
      }

      let takeProfitOrderResult = null
      if (takeProfitOrderData) {
        takeProfitOrderResult = await sendOrder(takeProfitOrderData)
        console.log('takeProfitOrderResult:', takeProfitOrderResult.data)

        // Store the take profit order ID for potential cleanup
        takeProfitOrderId = takeProfitOrderResult.data.sendStatus?.order_id || null
        if (takeProfitOrderId) {
          orderIds.push(takeProfitOrderId)
          
          // Update position with take profit order if we're tracking it
          if (positionId && !noDB) {
            const position = await getPosition(positionId)
            if (position) {
              await updatePosition(positionId, {
                orders: {
                  ...position.orders,
                  takeProfit: {
                    orderId: takeProfitOrderId,
                    status: 'PLACED',
                    price: takeProfitConfig.price,
                    timestamp: new Date()
                  }
                }
              })
            }
          }
        }

        // Verify take profit order
        if (takeProfitOrderId) {
          const takeProfitOrderVerified = await verifyOrder(takeProfitOrderId, 'placed', true)
          if (!takeProfitOrderVerified) {
            // If verification fails, try to cancel the order
            if (takeProfitOrderId) {
              console.log(`Verification failed for take profit order ${takeProfitOrderId}, attempting to cancel...`)
              try {
                await cancelOrder(takeProfitOrderId)
                console.log(`Successfully cancelled take profit order ${takeProfitOrderId}`)
              } catch (cancelError) {
                console.error(`Failed to cancel take profit order ${takeProfitOrderId}:`, cancelError)
              }
            }
            throw new Error('Failed to verify take profit order execution')
          }

          // Update position with verified take profit order status
          if (positionId && !noDB) {
            await updateOrderStatus(positionId, 'takeProfit', 'TRIGGER_PLACED')
          }
        }
      }

      return {
        marketOrder: marketOrderResult.data,
        stopOrder: stopOrderResult?.data,
        takeProfitOrder: takeProfitOrderResult?.data,
        orderIds,
        positionId
      }
    }

    return {
      marketOrder: null,
      stopOrder: null,
      takeProfitOrder: null,
      orderIds: [],
      positionId: undefined
    }
  } catch (error) {
    // Final cleanup - try to cancel only orders we created
    try {
      for (const id of orderIds) {
        await cancelOrder(id)
      }
      console.log('Cleanup complete after error')
    } catch (cleanupError) {
      console.error('Failed to cleanup orders after error:', cleanupError)
    }

    console.error('Error placing order:', error)
    return {
      marketOrder: null,
      stopOrder: null,
      takeProfitOrder: null,
      status: 'failed',
      error: error instanceof Error ? error.message : String(error),
      orderIds: [],
      positionId: undefined
    }
  }
}

/**
 * Places a standalone stop, trailing stop, or take profit order (no market order, no DB logic)
 */
export async function placeStandaloneOrder(
  orderType: 'stp' | 'trailing_stop' | 'take_profit',
  side: 'buy' | 'sell',
  size: number,
  symbol: string,
  config: {
    stopPrice?: number,
    distance?: number,
    deviationUnit?: 'PERCENT',
  } = {},
  reduceOnly: boolean = true
) {
  let orderData: any = {
    orderType,
    symbol,
    side: side.toLowerCase(),
    size,
    reduceOnly,
    triggerSignal: 'mark'
  }
  if (orderType === 'stp' && config.stopPrice !== undefined) {
    orderData.stopPrice = roundPrice(config.stopPrice, getPricePrecision(symbol))
  }
  if (orderType === 'trailing_stop' && config.distance !== undefined) {
    orderData.trailingStopDeviationUnit = config.deviationUnit || 'PERCENT'
    orderData.trailingStopMaxDeviation = config.distance
  }
  if (orderType === 'take_profit' && config.stopPrice !== undefined) {
    orderData.stopPrice = roundPrice(config.stopPrice, getPricePrecision(symbol))
  }
  console.log('[StandaloneOrder] Placing order:', orderData)
  const result = await sendOrder(orderData)
  console.log('[StandaloneOrder] Result:', result.data)
  return result.data
}

export async function getOpenPositions() {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  const payload = {}  // Empty payload for GET request
  const data = querystring.stringify(payload)
  const signature = getKrakenSignature('/api/v3/openpositions', nonce, data)

  let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/openpositions',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce
    }
  }

  try {
    return await axios.request(config)
  } catch (error) {
    console.error('API Error:', (error as any).response?.data || (error as any).message)
    throw error
  }
}

export async function getOrderStatus(orderId: string) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  const payload = {
    orderIds: orderId  // Send the single order ID directly
  }
  const data = querystring.stringify(payload)
  const signature = getKrakenSignature('/api/v3/orders/status', nonce, data)

  let config = {
    method: 'POST',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/orders/status',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce,
    },
    data: data
  }

  try {
    const response = await axios.request(config)
    if (response.data.result === 'success' && response.data.orders?.length > 0) {
      return response.data.orders[0]
    }
    throw new Error('Order not found or invalid response')
  } catch (error) {
    console.error('API Error:', (error as any).response?.data || (error as any).message)
    throw error
  }
}

export async function cancelOrder(orderId: string) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  const payload = {
    order_id: orderId  // Futures API uses order_id
  }
  const data = querystring.stringify(payload)
  const signature = getKrakenSignature('/api/v3/cancelorder', nonce, data)

  let config = {
    method: 'POST',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/cancelorder',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      'APIKey': API_KEY,
      'Authent': signature,
      'Nonce': nonce,
    },
    data: data
  }

  try {
    const response = await axios.request(config)
    if (response.data.result !== 'success') {
      throw new Error(`Failed to cancel order: ${response.data.error || 'Unknown error'}`)
    }
    return response.data
  } catch (error) {
    console.error('API Error:', (error as any).response?.data || (error as any).message)
    throw error
  }
}

/**
 * Closes any open position for the given symbol
 */
export async function cleanupPosition(symbol: string, strategyId?: string): Promise<boolean> {
  try {
    const response = await getOpenPositions()
    const positions = response.data.openPositions || []
    const position = positions.find((pos: any) => pos.symbol === symbol)
    
    if (!position) {
      return true // No position to clean up
    }

    // If we have a position, place a market order to close it
    const side = position.side === 'long' ? 'sell' : 'buy'
    const size = Math.abs(position.size)
    
    const result = await placeOrderWithExits(side, size, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, symbol, true, strategyId, 'fixed')
    
    if (result.marketOrder?.result !== 'success') {
      throw new Error('Failed to close position')
    }

    // If we have a position ID, mark it as closed
    if (result.positionId) {
      const currentPrice = await getCurrentPrice(symbol)
      await closePosition(result.positionId, currentPrice, result.marketOrder.sendStatus.order_id, 'strategy')
    }

    // Verify position is closed
    const finalCheck = await hasOpenPosition(symbol)
    return !finalCheck

  } catch (error) {
    console.error('Error cleaning up position:', error)
    return false
  }
}

/**
 * Checks if we have an open position for the given symbol
 */
export async function hasOpenPosition(symbol: string): Promise<boolean> {
  try {
    const response = await getOpenPositions()
    const positions = response.data.openPositions || []
    const position = positions.find((pos: any) => pos.symbol === symbol)
    
    if (position) {
      console.log(`Current position: ${position.side} ${position.size} ${position.symbol}`)
    }
    
    return Boolean(position)
  } catch (error) {
    console.error('Error checking open positions:', error)
    // If we can't verify, assume we might have a position to be safe
    return true
  }
}