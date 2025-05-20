const TELEGRAM_API_URL = 'https://api.telegram.org/bot'
const APPROVED_CHAT_IDS = [252360572] // Hard-coded for now, we can move this to a config file later

/**
 * Sends a message to approved Telegram chats
 * @param {string} message - The message to send
 * @returns {Promise<void>}
 */
export async function sendTelegramAlert(message) {
  if (!process.env.TELEGRAM_BOT_API_KEY) {
    console.error('TELEGRAM_BOT_API_KEY not found in environment variables')
    return
  }

  const botToken = process.env.TELEGRAM_BOT_API_KEY
  const url = `${TELEGRAM_API_URL}${botToken}/sendMessage`

  try {
    // Send to all approved chat IDs
    const sendPromises = APPROVED_CHAT_IDS.map(chatId => 
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML' // Allows basic HTML formatting
        })
      })
    )

    const results = await Promise.allSettled(sendPromises)
    
    // Log any failures
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to send Telegram alert to chat ID ${APPROVED_CHAT_IDS[index]}:`, result.reason)
      }
    })
  } catch (error) {
    console.error('Error sending Telegram alert:', error)
  }
} 