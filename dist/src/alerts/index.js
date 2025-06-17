import { sendTelegramAlert } from './telegram.js';
export const sendAlert = (message) => {
    sendTelegramAlert(message);
};
