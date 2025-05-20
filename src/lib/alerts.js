import { sendTelegramAlert } from './telegram'

export const sendAlert = (message) => {
    sendTelegramAlert(message)
}