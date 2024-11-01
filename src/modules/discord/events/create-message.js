const { webhookService } = require("../services/index")
const filters = require("../../../configs/guild_whitelist.json")

const { DISCORD_TREASURE_CHANNEL_WEBHOOK, DISCORD_ARCADE_CHANNEL_WEBHOOK, DISCORD_TEST_CHANNEL_WEBHOOK, DISCORD_LUNAR_CHANNEL_WEBHOOK, DISCORD_SAKURA_CHANNEL_WEBHOOK } = require("../../../configs/app.config")

async function on_message_create(message) {
    let post = ""
    try {
        const channelFilter = filters[message.channelId];
        if (!channelFilter) return // Якщо фільтра для цього channelId не існує, просто виходимо

        const keywords = channelFilter.filter;
        const contentIncludesKeywords = keywords.some(keyword =>
            message.content.toLowerCase().includes(keyword.toLowerCase())
        );

        if (!contentIncludesKeywords) return // Якщо повідомлення не містить жодного ключового слова, ігноруємо його

        let sanitized_content = message.content
            .replace(/@here/g, 'here')
            .replace(/@everyone/g, 'everyone');

        const urlRegex = /(https?:\/\/[^\s]+)/g;

        sanitized_content = sanitized_content.replace(urlRegex, '<$1>');

        const webhook_urls = {
            Arcade: DISCORD_ARCADE_CHANNEL_WEBHOOK,
            Treasure: DISCORD_TREASURE_CHANNEL_WEBHOOK,
            Lunar: DISCORD_LUNAR_CHANNEL_WEBHOOK,
            Sakura: DISCORD_SAKURA_CHANNEL_WEBHOOK,
            Test: DISCORD_TEST_CHANNEL_WEBHOOK,
        }

        let webhook_url = webhook_urls[channelFilter.type];

        post = "## 〓 " + channelFilter.guild_name + "\n" +
            sanitized_content

        console.log('Message passed the filter:', post)

        await webhookService.send_webhook_message(webhook_url, post)
    } catch (error) {
        console.log(error)
    }
}

module.exports = {
    on_message_create
}