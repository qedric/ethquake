import { 
  placeOrder, 
  getCurrentPrice, 
  getOpenPositions, 
  hasOpenPosition,
  cleanupPosition,
  replaceOrder,
  getOrderStatus,
  cancelOrder
} from '../kraken.js'

const TEST_SYMBOL = 'PF_SOLUSD'
const TEST_SIZE = 0.1  // Small size for testing

interface TestCase {
  name: string
  fn: () => Promise<void>
}

// Helper function to wait
const wait = (ms: number) => new Promise(resolve => setTimeout(resolve, ms))

async function debugPosition(symbol: string) {
  try {
    const response = await getOpenPositions()
    console.log('Open positions response:', JSON.stringify(response.data, null, 2))
    
    // Find position for our specific symbol
    const position = response.data.openPositions?.find((pos: any) => pos.symbol === symbol)
    if (position) {
      console.log(`Found ${position.side} position of size ${position.size} for ${symbol}`)
    } else {
      console.log(`No position found for ${symbol}`)
    }
    
    return Boolean(position)
  } catch (error) {
    console.error('Error checking positions:', error)
    throw error
  }
}

async function debugOrderStatus(orderId: string) {
  try {
    const status = await getOrderStatus(orderId)
    console.log('Order status response:', JSON.stringify(status, null, 2))
    return status
  } catch (error) {
    console.error('Error getting order status:', error)
    if ((error as any).response?.data) {
      console.error('API response:', JSON.stringify((error as any).response.data, null, 2))
    }
    throw error
  }
}

async function waitForOrderExecution(orderId: string, isTriggerOrder: boolean = false, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      console.log(`\nChecking order ${orderId} status (attempt ${i + 1}/${maxAttempts})...`)
      const status = await debugOrderStatus(orderId)
      
      // Log full status object for debugging
      console.log('Full order status:', JSON.stringify(status, null, 2))
      
      // For trigger orders (stops/take profits), TRIGGER_PLACED is a success state
      // For market orders, only FULLY_EXECUTED or FILLED is success
      const validStates = isTriggerOrder 
        ? ['FULLY_EXECUTED', 'FILLED', 'TRIGGER_PLACED'] 
        : ['FULLY_EXECUTED', 'FILLED']
      
      if (validStates.includes(status.status)) {
        console.log(`Order ${orderId} in valid state: ${status.status}`)
        return true
      }
      
      console.log(`Order ${orderId} in state ${status.status}, waiting for one of: ${validStates.join(', ')}`)
      await wait(3000)
    } catch (error) {
      console.error(`Error checking order status (attempt ${i + 1}):`, error)
      await wait(3000)
    }
  }
  return false
}

async function waitForPosition(symbol: string, expectedState: boolean, maxAttempts = 10): Promise<boolean> {
  for (let i = 0; i < maxAttempts; i++) {
    console.log(`\nChecking for position (attempt ${i + 1}/${maxAttempts})...`)
    const hasPosition = await debugPosition(symbol)
    
    // If we found what we were looking for, return true
    if (hasPosition === expectedState) {
      return true
    }
    
    // If we didn't find what we were looking for, log and wait
    console.log(`Position check ${hasPosition ? 'found' : 'not found'}, expected ${expectedState ? 'found' : 'not found'}`)
    await wait(3000) // Wait 5 seconds between checks
  }
  return false
}

const tests: TestCase[] = [
  {
    name: 'Basic market orders - long and short',
    fn: async () => {
      // Open long position
      console.log('\nPlacing long market order...')
      const longResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, false, undefined, 'fixed')
      if (!longResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place long market order')
      }
      const longOrderId = longResult.marketOrder.sendStatus.order_id
      console.log('Long order placed, ID:', longOrderId)
      
      // Wait for order execution
      console.log('\nWaiting for long order execution...')
      if (!await waitForOrderExecution(longOrderId)) {
        throw new Error('Long order execution timeout')
      }
      console.log('Long order executed')
      
      // Wait and verify position
      console.log('\nVerifying long position...')
      if (!await waitForPosition(TEST_SYMBOL, true)) {
        throw new Error('Long position not detected after multiple attempts')
      }
      console.log('Long position verified')
      
      // Close long position
      console.log('\nClosing long position...')
      const closeLongResult = await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true, undefined, 'fixed')
      if (!closeLongResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place closing sell order')
      }
      const closeLongOrderId = closeLongResult.marketOrder.sendStatus.order_id
      console.log('Close long order placed, ID:', closeLongOrderId)
      
      // Wait for close order execution
      console.log('\nWaiting for long close order execution...')
      if (!await waitForOrderExecution(closeLongOrderId)) {
        throw new Error('Long close order execution timeout')
      }
      console.log('Long close order executed')
      
      // Wait for position to close
      console.log('\nVerifying long position closure...')
      if (!await waitForPosition(TEST_SYMBOL, false)) {
        throw new Error('Long position still detected after closing')
      }
      console.log('Long position closed')
      
      await wait(3000) // Additional wait before opening short
      
      // Open short position
      console.log('\nPlacing short market order...')
      const shortResult = await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, false, undefined, 'fixed')
      if (!shortResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place short market order')
      }
      const shortOrderId = shortResult.marketOrder.sendStatus.order_id
      console.log('Short order placed, ID:', shortOrderId)
      
      // Wait for order execution
      console.log('\nWaiting for short order execution...')
      if (!await waitForOrderExecution(shortOrderId)) {
        throw new Error('Short order execution timeout')
      }
      console.log('Short order executed')
      
      // Wait and verify position
      console.log('\nVerifying short position...')
      if (!await waitForPosition(TEST_SYMBOL, true)) {
        throw new Error('Short position not detected after multiple attempts')
      }
      console.log('Short position verified')
      
      // Close short position
      console.log('\nClosing short position...')
      const closeShortResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true, undefined, 'fixed')
      if (!closeShortResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place closing buy order')
      }
      const closeShortOrderId = closeShortResult.marketOrder.sendStatus.order_id
      console.log('Close short order placed, ID:', closeShortOrderId)
      
      // Wait for close order execution
      console.log('\nWaiting for short close order execution...')
      if (!await waitForOrderExecution(closeShortOrderId)) {
        throw new Error('Short close order execution timeout')
      }
      console.log('Short close order executed')
      
      // Wait for position to close
      console.log('\nVerifying short position closure...')
      if (!await waitForPosition(TEST_SYMBOL, false)) {
        throw new Error('Short position still detected after closing')
      }
      console.log('Short position closed')
    }
  },
  {
    name: 'Long position with fixed stop loss and take profit',
    fn: async () => {
      // Get current price
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      console.log('Current price:', currentPrice)
      
      // Calculate stop loss and take profit prices
      const stopLossPrice = currentPrice * 0.98  // 2% below
      const takeProfitPrice = currentPrice * 1.02  // 2% above
      
      console.log('Stop loss price:', stopLossPrice)
      console.log('Take profit price:', takeProfitPrice)
      
      // Place the order with stop loss and take profit
      const result = await placeOrder(
        'buy',
        TEST_SIZE,
        { type: 'fixed', distance: 0, stopPrice: stopLossPrice },
        { type: 'limit', price: takeProfitPrice },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )
      
      // Verify market order
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market order')
      }
      const marketOrderId = result.marketOrder.sendStatus.order_id
      console.log('Market order placed, ID:', marketOrderId)
      
      // Wait for market order execution
      console.log('\nWaiting for market order execution...')
      if (!await waitForOrderExecution(marketOrderId, false)) {
        throw new Error('Market order execution timeout')
      }
      console.log('Market order executed')
      
      // Verify stop loss order
      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place stop loss order')
      }
      const stopOrderId = result.stopOrder.sendStatus.order_id
      console.log('Stop loss order placed, ID:', stopOrderId)
      
      // Wait for stop order placement
      console.log('\nWaiting for stop loss order placement...')
      if (!await waitForOrderExecution(stopOrderId, true)) {
        throw new Error('Stop loss order placement failed')
      }
      console.log('Stop loss order confirmed')
      
      // Verify take profit order
      if (!result.takeProfitOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place take profit order')
      }
      const tpOrderId = result.takeProfitOrder.sendStatus.order_id
      console.log('Take profit order placed, ID:', tpOrderId)
      
      // Wait for take profit order placement
      console.log('\nWaiting for take profit order placement...')
      if (!await waitForOrderExecution(tpOrderId, true)) {
        throw new Error('Take profit order placement failed')
      }
      console.log('Take profit order confirmed')
      
      // Wait and verify position
      console.log('\nVerifying position...')
      if (!await waitForPosition(TEST_SYMBOL, true)) {
        throw new Error('Position not detected after multiple attempts')
      }
      console.log('Position verified')
      
      // Clean up
      console.log('\nCleaning up position...')
      await cleanupPosition(TEST_SYMBOL)
      console.log('Position cleaned up')
    }
  },
  {
    name: 'Short position with fixed stop loss and take profit',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const stopPrice = currentPrice * 1.02  // 2% above
      const takeProfitPrice = currentPrice * 0.98  // 2% below

      console.log('Current price:', currentPrice)
      console.log('Stop loss price:', stopPrice)
      console.log('Take profit price:', takeProfitPrice)

      // Place short with both SL and TP
      const result = await placeOrder(
        'sell',
        TEST_SIZE,
        { type: 'fixed', distance: 0, stopPrice },
        { type: 'limit', price: takeProfitPrice },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )

      // Validate all orders
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market sell order')
      }
      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place stop loss order')
      }
      if (!result.takeProfitOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place take profit order')
      }

      // Clean up
      await cleanupPosition(TEST_SYMBOL)
    }
  },
  {
    name: 'Long position with trailing stop',
    fn: async () => {
      const trailDistance = 1  // 1% trailing distance

      // Place long with trailing stop
      const result = await placeOrder(
        'buy',
        TEST_SIZE,
        { type: 'trailing', distance: trailDistance },
        { type: 'none', price: 0 },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )

      // Validate orders
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }
      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place trailing stop order')
      }

      // Verify trailing stop
      const stopStatus = await getOrderStatus(result.stopOrder.sendStatus.order_id)
      if (!stopStatus.status.includes('TRIGGER_PLACED')) {
        throw new Error(`Unexpected trailing stop status: ${stopStatus.status}`)
      }

      // Clean up
      await cleanupPosition(TEST_SYMBOL)
    }
  },
  {
    name: 'Short position with trailing stop',
    fn: async () => {
      const trailDistance = 1  // 1% trailing distance

      // Place short with trailing stop
      const result = await placeOrder(
        'sell',
        TEST_SIZE,
        { type: 'trailing', distance: trailDistance },
        { type: 'none', price: 0 },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )

      // Validate orders
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market sell order')
      }
      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place trailing stop order')
      }

      // Clean up
      await cleanupPosition(TEST_SYMBOL)
    }
  },
  {
    name: 'Replace stop and take profit orders',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      
      // Initial order parameters
      const initialStopPrice = currentPrice * 0.99  // 1% below
      const initialTpPrice = currentPrice * 1.01    // 1% above
      
      // New order parameters
      const newStopPrice = currentPrice * 0.98     // 2% below
      const newTpPrice = currentPrice * 1.02       // 2% above

      console.log('Current price:', currentPrice)
      console.log('Initial stop/tp:', initialStopPrice, initialTpPrice)
      console.log('New stop/tp:', newStopPrice, newTpPrice)

      // Place initial position with both stop and take profit
      const initialResult = await placeOrder(
        'buy',
        TEST_SIZE,
        { type: 'fixed', distance: 0, stopPrice: initialStopPrice },
        { type: 'limit', price: initialTpPrice },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )

      if (!initialResult.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place initial stop order')
      }
      if (!initialResult.takeProfitOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place initial take profit order')
      }

      // Replace the stop order
      console.log('\nReplacing stop order...')
      const replaceStopResult = await replaceOrder(
        initialResult.stopOrder.sendStatus.order_id,
        'buy',
        TEST_SIZE,
        { type: 'fixed', distance: 0, stopPrice: newStopPrice },
        { type: 'none', price: 0 },
        TEST_SYMBOL,
        true, // isStopOrder
        'fixed'
      )

      if (!replaceStopResult.success || !replaceStopResult.newOrderId) {
        throw new Error('Failed to replace stop order')
      }

      // Verify new stop
      console.log('Verifying new stop order...')
      if (!await waitForOrderExecution(replaceStopResult.newOrderId, true)) {
        throw new Error('Failed to verify new stop order')
      }
      console.log('New stop order verified')

      // Replace the take profit order
      console.log('\nReplacing take profit order...')
      const replaceTpResult = await replaceOrder(
        initialResult.takeProfitOrder.sendStatus.order_id,
        'buy',
        TEST_SIZE,
        { type: 'none', distance: 0 },
        { type: 'limit', price: newTpPrice },
        TEST_SYMBOL,
        false, // isStopOrder
        'fixed'
      )

      if (!replaceTpResult.success || !replaceTpResult.newOrderId) {
        throw new Error('Failed to replace take profit order')
      }

      // Verify new take profit
      console.log('Verifying new take profit order...')
      if (!await waitForOrderExecution(replaceTpResult.newOrderId, true)) { // Note: true because it's a trigger order
        throw new Error('Failed to verify new take profit order')
      }
      console.log('New take profit order verified')

      // Clean up
      await cleanupPosition(TEST_SYMBOL)
    }
  },
  {
    name: 'Position cleanup and verification',
    fn: async () => {
      // Open a position
      await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, false, undefined, 'fixed')
      
      // Verify it exists
      if (!await hasOpenPosition(TEST_SYMBOL)) {
        throw new Error('Position not detected after opening')
      }
      
      // Clean it up
      const cleaned = await cleanupPosition(TEST_SYMBOL)
      if (!cleaned) {
        throw new Error('Failed to clean up position')
      }
      
      // Verify it's gone
      if (await hasOpenPosition(TEST_SYMBOL)) {
        throw new Error('Position still detected after cleanup')
      }
    }
  },
  {
    name: 'Order cancellation',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const farStopPrice = currentPrice * 0.95  // 5% below

      console.log('Current price:', currentPrice)
      console.log('Far stop price:', farStopPrice)

      // Place a stop order
      const result = await placeOrder(
        'buy',
        TEST_SIZE,
        { type: 'fixed', distance: 0, stopPrice: farStopPrice },
        { type: 'none', price: 0 },
        TEST_SYMBOL,
        false,
        undefined,
        'fixed'
      )

      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place stop order')
      }

      // Cancel it
      const cancelResult = await cancelOrder(result.stopOrder.sendStatus.order_id)
      if (cancelResult.result !== 'success') {
        throw new Error('Failed to cancel order')
      }

      // Verify cancellation
      try {
        const status = await getOrderStatus(result.stopOrder.sendStatus.order_id)
        // Order might still exist but be cancelled
        if (status.status.toLowerCase() !== 'cancelled') {
          throw new Error(`Order still exists and is not cancelled: ${status.status}`)
        }
      } catch (error) {
        // Either order is not found (good) or some other error occurred
        if (!(error as any).message.includes('Order not found')) {
          throw error
        }
      }

      // Clean up any position if it was opened
      await cleanupPosition(TEST_SYMBOL)
    }
  }
]

async function runTests(targetIndices?: number[]) {
  let passed = 0
  let failed = 0

  console.log('\n=== Starting test suite ===\n')

  for (let i = 0; i < tests.length; i++) {
    // Skip tests not in targetIndices if specified
    if (targetIndices && !targetIndices.includes(i)) {
      continue
    }

    const test = tests[i]
    console.log(`=== Running test: ${test.name} ===`)
    
    try {
      await test.fn()
      console.log(`✅ ${test.name} passed`)
      passed++
    } catch (error) {
      console.error(`❌ ${test.name} failed:`, error)
      failed++
      
      // Attempt cleanup after failure
      console.log('Cleaning up after test failure...')
      try {
        await cleanupPosition(TEST_SYMBOL)
      } catch (cleanupError) {
        console.error('Error during cleanup:', cleanupError)
      }
    }
  }

  console.log('\n=== Test suite complete ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${targetIndices ? targetIndices.length : tests.length}`)
}

// Export the tests array and runTests function
export { tests, runTests }

// If this file is run directly, run all tests
if (process.argv[1].endsWith('test-orders.ts') || process.argv[1].endsWith('test-orders.js')) {
  // Check if specific test indices were provided as arguments
  const targetIndices = process.argv.slice(2)
    .map(arg => parseInt(arg))
    .filter(index => !isNaN(index) && index >= 0 && index < tests.length)

  runTests(targetIndices.length > 0 ? targetIndices : undefined)
} 