const axios = require("axios")

/**
 * Функція для надсилання повідомлення на Discord Webhook.
 * @param {string} webhookUrl - URL твого Discord Webhook.
 * @param {string} message - Повідомлення для надсилання.
 * @returns {Promise<void>}
 */
async function send_webhook_message(webhook, payload) {
    let webhook_url = "https://discord.com/api/webhooks/" + webhook

    try {
        const response = await axios.post(webhook_url, payload);

        console.log("RESPONSE STATUS: ", response.status)
    } catch (error) {
        console.error('Помилка при надсиланні повідомлення:', error.response ? error.response.data : error.message);
    }
}

module.exports = {
    send_webhook_message
}