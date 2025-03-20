import crypto from 'crypto'
import axios from 'axios'
import dotenv from 'dotenv'

dotenv.config()

// Kraken API credentials
const API_KEY = process.env.KRAKEN_API_KEY
const API_SECRET = process.env.KRAKEN_API_SECRET

// Kraken WebSocket API URL for futures
//const WS_URL = 'wss://futures.kraken.com/ws/v2'
const REST_URL = 'https://futures.kraken.com/derivatives/api/v3'

/**
 * Gets the current market price for ETH futures
 */
export async function getMarketPrice() {
  try {
    const response = await axios.get(`${REST_URL}/tickers`)
    const ethFuture = response.data.tickers.find(t => t.symbol === 'PI_ETHUSD')
    
    if (!ethFuture) {
      throw new Error('ETH futures ticker not found')
    }
    
    return {
      price: parseFloat(ethFuture.last),
      bid: parseFloat(ethFuture.bid),
      ask: parseFloat(ethFuture.ask),
      timestamp: new Date()
    }
  } catch (error) {
    console.error('Error getting market price:', error)
    throw error
  }
}

/**
 * Places an order on Kraken Futures
 * @param {string} side - 'buy' or 'sell'
 * @param {number} size - Position size in ETH
 */
export async function placeOrder(side, size) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }
  
  try {
    const endpoint = '/api/add_order'
    const nonce = Date.now()
    
    // Create the order data
    const orderData = {
      symbol: 'PI_ETHUSD',
      type: 'market',
      side: side.toLowerCase(),
      size: size,
      nonce: nonce
    }
    
    // Create signature for authentication
    const payload = JSON.stringify(orderData)
    const signature = createSignature(endpoint, payload, nonce)
    
    // Make the API request
    const response = await axios.post(
      `${REST_URL}${endpoint}`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'X-KRAKEN-SIGN': signature,
          'X-KRAKEN-API-KEY': API_KEY,
          'X-KRAKEN-API-NONCE': nonce
        }
      }
    )
    
    return {
      orderId: response.data.result?.order_id,
      status: 'placed',
      raw: response.data
    }
  } catch (error) {
    console.error('Error placing order:', error)
    return {
      status: 'failed',
      error: error.message
    }
  }
}

/**
 * Creates a signature for Kraken API authentication
 */
function createSignature(endpoint, payload, nonce) {
  const message = endpoint + crypto
    .createHash('sha256')
    .update(nonce + payload)
    .digest('binary')
  
  return crypto
    .createHmac('sha512', Buffer.from(API_SECRET, 'base64'))
    .update(message)
    .digest('base64')
} 