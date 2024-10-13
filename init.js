const path = require("path")

const { check_and_create_file } = require("./src/shared/utils")

async function init() {
    try {
        const guild_whitelist_path = path.join(process.cwd(), "src", "configs", "guild_whitelist.json")
        const dotenv_path = path.join(process.cwd(), ".env")

        let data = {
            "<channelId>": {
                "guild_name": "test",
                "guildId": "testguildid",
                "target_discord": ["Discrod channel id"],
                "target_telegram": ["Telegram channel id"],
                "filter": ["key", "words"],
                "type": "Arcade"
            }
        }

        let dotenv_data = 'DISCORD_TOKEN = ""\n' +
            'DISCORD_TREASURE_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_ARCADE_CHANNEL_WEBHOOK = ""\n' +
            'DISCORD_TEST_CHANNEL_WEBHOOK = ""\n'

        await check_and_create_file(guild_whitelist_path, data)
        await check_and_create_file(dotenv_path, dotenv_data)

        console.log("Pls fill " + guild_whitelist_path + " with data")
        console.log("Pls fill " + dotenv_path + " with enviroment variables")

    } catch (error) {
        console.log(error)
    }
}

init()