import { placeOrder, getOrderStatus, cancelOrder, hasOpenPosition, getCurrentPrice } from '../kraken.js'

interface TestCase {
  name: string
  fn: () => Promise<void>
}

const TEST_SYMBOL = 'PF_SOLUSD'
const TEST_SIZE = 0.1

const tests: TestCase[] = [
  {
    name: 'Place and cancel market order',
    fn: async () => {
      // Place a market buy order
      const buyResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL)
      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with trailing stop',
    fn: async () => {
      // Place a market buy order with trailing stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'trailing',
        distance: 1.0
      }, { type: 'none', price: 0 }, TEST_SYMBOL)

      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      if (!buyResult.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place trailing stop order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with fixed stop',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const stopPrice = Math.round(currentPrice * 0.99 * 100) / 100 // 1% below current price, rounded to 2 decimals

      // Place a market buy order with fixed stop
      const buyResult = await placeOrder('buy', TEST_SIZE, {
        type: 'fixed',
        distance: 1.0,
        stopPrice
      }, { type: 'none', price: 0 }, TEST_SYMBOL)

      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      if (!buyResult.stopOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place fixed stop order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place and verify market order',
    fn: async () => {
      // Place a market buy order
      const result = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL)
      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with take profit',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const takeProfitPrice = Math.round(currentPrice * 1.01 * 100) / 100 // 1% above current price, rounded to 2 decimals

      // Place a market buy order with take profit
      const result = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, {
        type: 'limit',
        price: takeProfitPrice
      }, TEST_SYMBOL)

      if (!result.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      if (!result.takeProfitOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place take profit order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  },
  {
    name: 'Place order with stop and take profit',
    fn: async () => {
      const currentPrice = await getCurrentPrice(TEST_SYMBOL)
      const stopPrice = currentPrice * 0.99 // 1% below current price
      const takeProfitPrice = currentPrice * 1.01 // 1% above current price

      // Place a market buy order with both stop and take profit
      const buyResult = await placeOrder('buy', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL)
      if (!buyResult.marketOrder?.sendStatus?.order_id) {
        throw new Error('Failed to place market buy order')
      }

      // Wait a bit then close with a market sell
      await new Promise(resolve => setTimeout(resolve, 1000))
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  }
]

// Run tests
async function runTests() {
  for (const test of tests) {
    console.log(`Running test: ${test.name}`)
    try {
      await test.fn()
      console.log(`✅ Test passed: ${test.name}`)
    } catch (error) {
      console.error(`❌ Test failed: ${test.name}`)
      console.error(error)
    }
    // Ensure no position is left open
    await new Promise(resolve => setTimeout(resolve, 1000))
    const hasPosition = await hasOpenPosition(TEST_SYMBOL)
    if (hasPosition) {
      console.log('Cleaning up position...')
      await placeOrder('sell', TEST_SIZE, { type: 'none', distance: 0 }, { type: 'none', price: 0 }, TEST_SYMBOL, true)
    }
  }
}

runTests() 