import { sendTelegramAlert } from './telegram.ts'

export const sendAlert = (message) => {
    sendTelegramAlert(message)
}