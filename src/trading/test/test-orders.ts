import { placeOrder, getOrderStatus, cancelOrder, hasOpenPosition, getCurrentPrice } from '../kraken.js'

interface TestCase {
  name: string
  fn: () => Promise<void>
}

const SYMBOL = 'PF_ETHUSD'
const TEST_SIZE = 0.001  // Small test size

async function cleanupOrders(orderIds: string[]) {
  console.log('Cleaning up test orders...')
  for (const id of orderIds) {
    try {
      await cancelOrder(id)
    } catch (error) {
      // Ignore errors during cleanup - order might already be executed/cancelled
    }
  }
}

const tests: TestCase[] = [
  {
    name: 'Market order with no stop',
    fn: async () => {
      console.log('\nTesting market order with no stop...')
      
      // Place a buy order
      const buyResult = await placeOrder('buy', TEST_SIZE)
      console.log('Buy result:', buyResult)
      if (!buyResult.marketOrder) throw new Error('No buy order response')
      
      // Place an equal sell order to neutralize
      const sellResult = await placeOrder('sell', TEST_SIZE, undefined, SYMBOL, true)
      console.log('Sell result:', sellResult)
      if (!sellResult.marketOrder) throw new Error('No sell order response')
      
      // Clean up any remaining orders
      await cleanupOrders([...buyResult.orderIds, ...sellResult.orderIds])
    }
  },
  {
    name: 'Market order with trailing stop',
    fn: async () => {
      console.log('\nTesting market order with trailing stop...')
      
      // Get current price for stop calculation
      const price = await getCurrentPrice(SYMBOL)
      console.log('Current price:', price)
      
      // Place a buy order with trailing stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'trailing',
        distance: 1  // 1% trailing stop
      })
      console.log('Buy with stop result:', buyResult)
      if (!buyResult.marketOrder) throw new Error('No buy order response')
      if (!buyResult.stopOrder) throw new Error('No stop order response')
      
      // Place an equal sell order to neutralize, with its own trailing stop
      const sellResult = await placeOrder('sell', TEST_SIZE, {
        type: 'trailing',
        distance: 1
      }, SYMBOL, true)
      console.log('Sell with stop result:', sellResult)
      if (!sellResult.marketOrder) throw new Error('No sell order response')
      if (!sellResult.stopOrder) throw new Error('No stop order response')
      
      // Clean up any remaining orders
      await cleanupOrders([...buyResult.orderIds, ...sellResult.orderIds])
    }
  },
  {
    name: 'Market order with fixed stop',
    fn: async () => {
      console.log('\nTesting market order with fixed stop...')
      
      // Get current price for stop calculation
      const price = await getCurrentPrice(SYMBOL)
      const stopDistance = price * 0.01 // 1% stop
      
      // Place a buy order with fixed stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'fixed',
        distance: 1,
        stopPrice: price - stopDistance
      })
      console.log('Buy with stop result:', buyResult)
      if (!buyResult.marketOrder) throw new Error('No buy order response')
      if (!buyResult.stopOrder) throw new Error('No stop order response')
      
      // Place an equal sell order to neutralize, with its own fixed stop
      const sellResult = await placeOrder('sell', TEST_SIZE, {
        type: 'fixed',
        distance: 1,
        stopPrice: price + stopDistance
      }, SYMBOL, true)
      console.log('Sell with stop result:', sellResult)
      if (!sellResult.marketOrder) throw new Error('No sell order response')
      if (!sellResult.stopOrder) throw new Error('No stop order response')
      
      // Clean up any remaining orders
      await cleanupOrders([...buyResult.orderIds, ...sellResult.orderIds])
    }
  },
  {
    name: 'Order status check',
    fn: async () => {
      console.log('\nTesting order status check...')
      
      // Place a test order
      const result = await placeOrder('buy', TEST_SIZE)
      console.log('Test order result:', result)
      if (!result.marketOrder) throw new Error('No order response')
      
      // Check its status
      const orderId = result.marketOrder.sendStatus.order_id
      const status = await getOrderStatus(orderId)
      console.log('Order status:', status)
      
      // Place neutralizing sell order
      const sellResult = await placeOrder('sell', TEST_SIZE, undefined, SYMBOL, true)
      console.log('Neutralizing sell result:', sellResult)
      
      // Clean up any remaining orders
      await cleanupOrders([...result.orderIds, ...sellResult.orderIds])
    }
  },
  {
    name: 'Cancel order',
    fn: async () => {
      console.log('\nTesting order cancellation...')
      
      // Place an order with stop
      const result = await placeOrder('buy', TEST_SIZE, {
        type: 'trailing',
        distance: 1
      })
      console.log('Test order result:', result)
      if (!result.stopOrder) throw new Error('No stop order created')
      
      // Cancel the stop order
      const stopOrderId = result.stopOrder.sendStatus.order_id
      const cancelResult = await cancelOrder(stopOrderId)
      console.log('Cancel result:', cancelResult)
      
      // Place neutralizing sell order
      const sellResult = await placeOrder('sell', TEST_SIZE, undefined, SYMBOL, true)
      console.log('Neutralizing sell result:', sellResult)
      
      // Clean up any remaining orders
      await cleanupOrders([...result.orderIds, ...sellResult.orderIds])
    }
  },
  {
    name: 'Position check',
    fn: async () => {
      console.log('\nTesting position check...')
      
      // Check initial position
      const initialPosition = await hasOpenPosition(SYMBOL)
      console.log('Initial position check:', initialPosition)
      
      // Place a test position
      const buyResult = await placeOrder('buy', TEST_SIZE)
      console.log('Test buy result:', buyResult)
      
      // Check position again
      const midPosition = await hasOpenPosition(SYMBOL)
      console.log('Mid-test position check:', midPosition)
      
      // Close the test position
      const sellResult = await placeOrder('sell', TEST_SIZE, undefined, SYMBOL, true)
      console.log('Position close result:', sellResult)
      
      // Final position check
      const finalPosition = await hasOpenPosition(SYMBOL)
      console.log('Final position check:', finalPosition)
      
      // Clean up any remaining orders
      await cleanupOrders([...buyResult.orderIds, ...sellResult.orderIds])
    }
  }
]

async function runTests() {
  console.log('Starting order management tests...\n')
  
  let passed = 0
  let failed = 0
  
  for (const test of tests) {
    console.log(`=== Running test: ${test.name} ===\n`)
    try {
      await test.fn()
      console.log(`\n✅ ${test.name} passed\n`)
      passed++
    } catch (error) {
      console.error(`\n❌ ${test.name} failed:`, error)
      failed++
    }
  }
  
  console.log('\n=== Test Summary ===')
  console.log(`Passed: ${passed}`)
  console.log(`Failed: ${failed}`)
  console.log(`Total: ${tests.length}`)
}

runTests().catch(console.error) 