import dotenv from 'dotenv'
import axios from 'axios'

// Initialize dotenv
dotenv.config()


// Constants
const TW_CLIENT_ID = process.env.TW_CLIENT_ID
const DEFAULT_MIN_ETH_VALUE = '100000000000000000000'

if (!TW_CLIENT_ID) {
  console.error('Missing TW_CLIENT_ID in environment variables')
  process.exit(1)
}

/**
 * Fetches transactions from ThirdWeb Insights API with flexible filtering options
 * @param {Object} options - Filter options for the API query
 * @returns {Array} Array of transaction objects
 */
export async function fetchTransactions(options: Record<string, any> = {}) {
  const buildUrl = () => {
    let url = `https://insight.thirdweb.com/v1/transactions?chain=1&clientId=${TW_CLIENT_ID}`
    url += '&sort_by=block_number&sort_order=desc&limit=200'
    if (!options.filter_value_gte) {
      url += `&filter_value_gte=${DEFAULT_MIN_ETH_VALUE}`
    }
    for (const [key, value] of Object.entries(options)) {
      if (value === null || value === undefined) continue
      url += `&${key}=${value}`
    }
    return url
  }

  const maxRetries = 5
  const baseDelayMs = 300
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const url = buildUrl()
      const response = await axios.get(url)
      return response.data.data || []
    } catch (error) {
      const status = (error as any)?.response?.status
      const retriable = !status || [429, 500, 502, 503, 504].includes(status)
      console.error('Error fetching transactions:', error instanceof Error ? error.message : String(error))
      if ((error as any)?.response?.data) {
        const data = (error as any).response.data
        if (typeof data === 'string' && data.trim().toLowerCase().startsWith('<!doctype html')) {
          console.error('Response data: [HTML error page skipped]')
        } else {
          console.error('Response data:', data)
        }
        console.error('Response status:', status)
      }
      if (attempt < maxRetries - 1 && retriable) {
        const delay = baseDelayMs * Math.pow(2, attempt) + Math.floor(Math.random() * 200)
        await new Promise(r => setTimeout(r, delay))
        continue
      }
      return []
    }
  }
  return []
}