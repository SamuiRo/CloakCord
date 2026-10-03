const axios = require("axios")

const WEBHOOK_BASE = "https://discord.com/api/webhooks/"

/**
 * Надсилає повідомлення на Discord Webhook.
 * @param {string} webhook - "id/token" (так зберігається в БД) або повний URL.
 * @param {object} payload - тіло повідомлення (content, embeds).
 * @returns {Promise<void>} Кидає помилку, якщо Discord не прийняв повідомлення.
 */
async function send_webhook_message(webhook, payload) {
    const webhook_url = webhook.startsWith("https://") ? webhook : WEBHOOK_BASE + webhook

    try {
        await axios.post(webhook_url, payload, { timeout: 15000 })
    } catch (error) {
        // URL містить токен webhook-а, тому в помилку йде лише статус і тіло відповіді
        const details = error.response ? `${error.response.status} ${JSON.stringify(error.response.data)}` : error.message
        throw new Error(details)
    }
}

module.exports = {
    send_webhook_message
}
