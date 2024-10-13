const axios = require("axios")

/**
 * Функція для надсилання повідомлення на Discord Webhook.
 * @param {string} webhookUrl - URL твого Discord Webhook.
 * @param {string} message - Повідомлення для надсилання.
 * @returns {Promise<void>}
 */
async function send_webhook_message(webhookUrl, message) {
    try {
        const response = await axios.post(webhookUrl, {
            content: message
        });

        if (response.status === 204) {
            console.log('Повідомлення успішно надіслано.');
        }
    } catch (error) {
        console.error('Помилка при надсиланні повідомлення:', error.response ? error.response.data : error.message);
    }
}

module.exports = {
    send_webhook_message
}