const { webhookService } = require("../services/index")
const filters = require("../../../configs/guild_whitelist.json")
const { Channel } = require("../../pot/models/index")

async function on_message_create(message) {
    let post = {}
    try {
        const channelFilter = await Channel.findOne({ where: { channelId: message.channelId } })
        if (!channelFilter) return // Якщо фільтра для цього channelId не існує, просто виходимо

        const keywords = channelFilter.filter;
        const contentIncludesKeywords = keywords.some(keyword =>
            message.content.toLowerCase().includes(keyword.toLowerCase())
        );

        if (!contentIncludesKeywords) return // Якщо повідомлення не містить жодного ключового слова, ігноруємо його

        let sanitized_content = message.content
            .replace(/@here/g, 'here')
            .replace(/@everyone/g, 'everyone');

        if (channelFilter.suppress_embed) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            sanitized_content = sanitized_content.replace(urlRegex, '<$1>');
        }

        post = {
            content: `## 〓 ${channelFilter.guild_name}\n${sanitized_content}`,
            // files: [] // Список файлів
            embeds: []
        };

        if (message.attachments?.size > 0) {
            message.attachments.forEach(attachment => {
                if (attachment.contentType?.startsWith('image/')) {
                    post.embeds.push({
                        title: attachment.tittle,
                        image: { url: attachment.url }
                    });
                } else {
                    console.log(`Unsupported attachment type: ${attachment.contentType}`);
                }
            });
        }

        for (const discord_webhook_url of channelFilter.target_discord) {
            await webhookService.send_webhook_message(discord_webhook_url, post)
        }

    } catch (error) {
        console.log(error)
    }
}

module.exports = {
    on_message_create
}