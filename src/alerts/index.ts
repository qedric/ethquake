import { sendTelegramAlert } from './telegram.js'

export const sendAlert = (message: string) => {
    sendTelegramAlert(message)
}