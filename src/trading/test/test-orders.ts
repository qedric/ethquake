import { placeOrder, getOrderStatus, cancelOrder, hasOpenPosition, getCurrentPrice } from '../kraken.js'

interface TestCase {
  name: string
  fn: () => Promise<void>
}

const TEST_SIZE = 0.001 // Small size for testing
const TEST_SYMBOL = 'PF_XBTUSD' // Test symbol

const testCases: TestCase[] = [
  {
    name: 'Place and verify market order',
    fn: async () => {
      console.log('Testing market order placement and verification...')
      
      // Place a market buy order
      const buyResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL)
      
      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID from market order')
      }
      
      console.log('Market order result:', buyResult)
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with trailing stop',
    fn: async () => {
      console.log('Testing order placement with trailing stop...')
      
      // Place a buy order with trailing stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'trailing',
        distance: 1 // 1% trailing stop
      }, TEST_SYMBOL)
      
      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID from market order')
      }
      
      if (!buyResult.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID from stop order')
      }
      
      console.log('Order with trailing stop result:', buyResult)
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with fixed stop',
    fn: async () => {
      console.log('Testing order placement with fixed stop...')
      
      // Get current price for stop calculation
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const stopPrice = currentPrice * 0.99 // 1% below current price
      
      // Place a buy order with fixed stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'fixed',
        distance: 1,
        stopPrice
      }, TEST_SYMBOL)
      
      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID from market order')
      }
      
      if (!buyResult.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID from stop order')
      }
      
      console.log('Order with fixed stop result:', buyResult)
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Test order status retrieval',
    fn: async () => {
      console.log('Testing order status retrieval...')
      
      // Place a market order
      const result = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL)
      
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get order ID')
      }
      
      // Get the order status
      const status = await getOrderStatus(result.marketOrder.sendStatus.order_id)
      console.log('Order status:', status)
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Test order cancellation',
    fn: async () => {
      console.log('Testing order cancellation...')
      
      // Place an order with a stop
      const result = await placeOrder('buy', TEST_SIZE, {
        type: 'trailing',
        distance: 1
      }, TEST_SYMBOL)
      
      if (!result.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to get stop order ID')
      }
      
      // Cancel the stop order
      const cancelResult = await cancelOrder(result.stopOrder.sendStatus.order_id)
      console.log('Cancel result:', cancelResult)
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Test position verification',
    fn: async () => {
      console.log('Testing position verification...')
      
      // Place a market buy order
      const buyResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL)
      
      // Check if we have a position
      const hasPosition = await hasOpenPosition(TEST_SYMBOL)
      console.log('Has position:', hasPosition)
      
      if (!hasPosition) {
        throw new Error(`Position verification failed after order ${buyResult.marketOrder?.sendStatus?.order_id || 'unknown'}`)
      }
      
      // Close the position
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, TEST_SYMBOL, true)
      
      // Verify position is closed
      const finalCheck = await hasOpenPosition(TEST_SYMBOL)
      if (finalCheck) {
        throw new Error('Position not properly closed')
      }
    }
  }
]

// Run all test cases
async function runTests() {
  for (const testCase of testCases) {
    console.log(`\nRunning test: ${testCase.name}`)
    try {
      await testCase.fn()
      console.log(`✅ ${testCase.name} passed`)
    } catch (error) {
      console.error(`❌ ${testCase.name} failed:`, error)
    }
  }
}

runTests() 