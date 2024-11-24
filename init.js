const path = require("path")

const { check_and_create_file } = require("./src/shared/utils")
const { notify } = require("./src/shared/notification")

async function init() {
    try {
        await notify("Start CloakCord Initializing...")
        const guild_whitelist_path = path.join(process.cwd(), "src", "configs", "guild_whitelist.json")
        const dotenv_path = path.join(process.cwd(), ".env")
        const sqlite_db_path = path.join(process.cwd(), "pot.sqlite")

        let data = {
            "<channelId>": {
                "guild_name": "test",
                "guildId": "testguildid",
                "target_discord": ["Discrod channel id"],
                "target_telegram": ["Telegram channel id"],
                "filter": ["key", "words"],
                "suppress_embed": true,
                "type": "Arcade"
            }
        }

        let dotenv_data = 'DISCORD_TOKEN = ""\n\n' +
            'DISCORD_TREASURE_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_ARCADE_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_TEST_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_LUNAR_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_SAKURA_CHANNEL_WEBHOOK = ""\n\n' +
            'TELEGRAM_BOT_TOKEN = ""\n' +
            'TELEGRAM_CHANNEL_ID = ""\n' +
            'TELEGRAM_FORUM_ID = ""\n'

        await check_and_create_file(guild_whitelist_path, data)
        await check_and_create_file(dotenv_path, dotenv_data)

        console.log("Pls fill " + guild_whitelist_path + " with data")
        console.log("Pls fill " + dotenv_path + " with enviroment variables")

        await notify("CloakCord init complete")
    } catch (error) {
        console.log(error)
    }
}

init()