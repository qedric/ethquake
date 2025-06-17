import { placeOrder } from './kraken.js'
import dotenv from 'dotenv'

async function testPlaceOrder() {
  try {
    const side = 'sell' // or 'sell'
    const size = 0.001 // Position size in ETH
    const options = { trailingStop: 0.04 } as any // 4% trailing stop

    const result = await placeOrder(side, size, options)
    console.log('Order result:', result)
  } catch (error) {
    console.error('Error testing placeOrder:', error)
  }
}

testPlaceOrder() 