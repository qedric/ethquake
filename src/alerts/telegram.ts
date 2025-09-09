const TELEGRAM_API_URL = 'https://api.telegram.org/bot'

// Helper: parse comma-separated chat IDs from env to number[]
function parseChatIds(value?: string): number[] {
  if (!value) return []
  return value
    .split(',')
    .map(v => v.trim())
    .filter(v => v.length > 0)
    .map(v => Number(v))
    .filter(v => Number.isFinite(v))
}

// Backward-compatible default chat IDs (previous APPROVED_CHAT_IDS)
const DEFAULT_CHAT_IDS = (() => {
  const fromEnv = parseChatIds(process.env.TELEGRAM_CHAT_IDS_DEFAULT)
  if (fromEnv.length > 0) return fromEnv
  return [252360572, 1895974263]
})()

// Resolve chat IDs for a given strategy key
function getChatIdsForStrategy(strategyKey: string): number[] {
  const envKey = `TELEGRAM_CHAT_IDS_${strategyKey.toUpperCase()}`
  const ids = parseChatIds(process.env[envKey])
  if (ids.length > 0) return ids
  return DEFAULT_CHAT_IDS
}

/**
 * Sends a message to approved Telegram chats for a given strategy
 * @param message The message to send
 * @param strategyKey Strategy identifier, e.g. 'ethquake', 'tradingview', 'emas_btc'
 */
export async function sendTelegramAlert(message: string, strategyKey: string = 'ethquake') {
  if (!process.env.TELEGRAM_BOT_API_KEY) {
    console.error('TELEGRAM_BOT_API_KEY not found in environment variables')
    return
  }

  const botToken = process.env.TELEGRAM_BOT_API_KEY
  const url = `${TELEGRAM_API_URL}${botToken}/sendMessage`
  const approvedChatIds = getChatIdsForStrategy(strategyKey)

  try {
    const sendPromises = approvedChatIds.map(chatId => 
      fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'HTML'
        })
      })
    )

    const results = await Promise.allSettled(sendPromises)
    
    results.forEach((result, index) => {
      if (result.status === 'rejected') {
        console.error(`Failed to send Telegram alert to chat ID ${approvedChatIds[index]}:`, result.reason)
      }
    })
  } catch (error) {
    console.error('Error sending Telegram alert:', error)
  }
}