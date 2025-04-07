import crypto from 'crypto'
import axios from 'axios'
import dotenv from 'dotenv'
import querystring from 'querystring'

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
function getKrakenSignature(urlPath, nonce, data) {
  const encoded = data + nonce + urlPath
  const sha256Hash = crypto.createHash('sha256').update(encoded).digest()
  const secretBuffer = Buffer.from(API_SECRET, 'base64')
  const hmac = crypto.createHmac('sha512', secretBuffer).update(sha256Hash)
  const signature = hmac.digest('base64')
  return signature
}

async function sendOrder(payload) {

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
    console.error('API Error:', error.response?.data || error.message)
    throw error
  }
}

/**
 * Places an order on Kraken Futures
 * @param {string} side - 'buy' or 'sell'
 * @param {number} size - Position size in ETH
 * @param {object} options - Additional order options
 */
export async function placeOrder(side, size, marketOnly) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  try {
    // Create the market order data
    const marketOrderData = {
      orderType: 'mkt',
      symbol: 'PF_ETHUSD',
      size: size,
      side: side.toLowerCase()
    }

    // Create the trailing stop order data
    const trailingStopOrderData = {
      orderType: 'trailing_stop',
      symbol: 'PF_ETHUSD',
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: size,
      trailingStopDeviationUnit: 'PERCENT',
      trailingStopMaxDeviation: 4,
      reduceOnly: true,
      triggerSignal: 'mark'
    }

    const marketOrderResult = await sendOrder(marketOrderData)

    console.log('marketOrderResult:', marketOrderResult.data)

    if (marketOrderResult.data.result === 'success') {

      let trailingStopOrderResult = null
      if(!marketOnly){
        trailingStopOrderResult = await sendOrder(trailingStopOrderData)
        console.log('trailingStopOrderResult:', trailingStopOrderResult.data)
      }

      return {
        marketOrder: marketOrderResult.data,
        trailingStopOrder: trailingStopOrderResult?.data
      }
    }

    return {
      marketOrder: null,
      trailingStopOrder: null
    }
  } catch (error) {
    console.error('Error placing order:', error)
    return {
      status: 'failed',
      error: error.message
    }
  }
}

export async function getOpenPositions() {

  const nonce = Date.now().toString()
  const signature = getKrakenSignature('/api/v3/openpositions', nonce, '{}')

  let config = {
    method: 'get',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/openpositions',
    headers: {
      'Accept': 'application/json',
      'APIKey': API_KEY,
      'Authent': signature
    }
  }

  try {
    return await axios.request(config)
  } catch (error) {
    console.error('API Error:', error.response?.data || error.message)
    throw error
  }

}

export async function getOrderStatus(orderId) {
  if (!API_KEY || !API_SECRET) {
    throw new Error('Kraken API credentials not configured')
  }

  const nonce = Date.now().toString()
  const data = JSON.stringify({
    orderIds: [orderId]
  })
  const signature = getKrakenSignature('/api/v3/orders/status', nonce, data)

  let config = {
    method: 'POST',
    maxBodyLength: Infinity,
    url: 'https://futures.kraken.com/derivatives/api/v3/orders/status',
    headers: {
      'Content-Type': 'application/json',
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
    console.error('API Error:', error.response?.data || error.message)
    throw error
  }
}