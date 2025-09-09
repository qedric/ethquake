import { sendTelegramAlert } from './telegram.js'

export const sendAlert = (message: string, strategyKey: string = 'ethquake') => {
    sendTelegramAlert(message, strategyKey)
}