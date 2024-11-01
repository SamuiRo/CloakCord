require("dotenv").config()

module.exports = {
    DISCORD_TOKEN: process.env.DISCORD_TOKEN,
    DISCORD_TREASURE_CHANNEL_WEBHOOK: process.env.DISCORD_TREASURE_CHANNEL_WEBHOOK,
    DISCORD_ARCADE_CHANNEL_WEBHOOK: process.env.DISCORD_ARCADE_CHANNEL_WEBHOOK,
    DISCORD_TEST_CHANNEL_WEBHOOK: process.env.DISCORD_TEST_CHANNEL_WEBHOOK,
    DISCORD_LUNAR_CHANNEL_WEBHOOK: process.env.DISCORD_LUNAR_CHANNEL_WEBHOOK,
    DISCORD_SAKURA_CHANNEL_WEBHOOK: process.env.DISCORD_SAKURA_CHANNEL_WEBHOOK,
    
    TELEGRAM_BOT_TOKEN: process.env.TELEGRAM_BOT_TOKEN,
    TELEGRAM_CHANNEL_ID: process.env.TELEGRAM_CHANNEL_ID,
    TELEGRAM_FORUM_ID: process.env.TELEGRAM_FORUM_ID,

}