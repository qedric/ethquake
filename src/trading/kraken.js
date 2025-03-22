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

/**
 * Gets the current market price for ETH futures
 */
export async function getMarketPrice() {
  try {
    const response = await axios.get('https://futures.kraken.com/derivatives/api/v3\'/tickers')
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

async function sendOrder(payload) {

  const BaseURL = 'https://futures.kraken.com'
  const nonce = Date.now().toString()
  const payloadString = querystring.stringify(payload)

  const signature = getKrakenSignature('/api/v3/sendorder', nonce, payloadString)
  console.log(`Authent: ${signature}`)

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
export async function placeOrder(side, size) {
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
      symbol: 'PI_ETHUSD',
      side: side.toLowerCase() === 'buy' ? 'sell' : 'buy',
      size: size,
      trailingStopDeviationUnit: 'PERCENT',
      trailingStopMaxDeviation: 4,
      reduceOnly: true,
      triggerSignal: 'mark'
    }

    const marketOrderResult = await sendOrder(marketOrderData)

    console.log('marketOrderResult:', marketOrderResult)

    if (marketOrderResult.data.result === 'success') {

      const trailingStopOrderResult = await sendOrder(trailingStopOrderData)

      return {
        marketOrder: marketOrderResult.data,
        trailingStopOrder: trailingStopOrderResult.data
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