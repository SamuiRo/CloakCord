const { Channel } = require("./src/modules/pot/models/index")
const sequelize = require("./src/modules/pot/sqlite_db")

const guild_list = require("./src/configs/guild_whitelist.json")

async function upload() {
    try {
        await _connectDB()

        for (const guild in guild_list) {
            const detailes = guild_list[guild]

            const import_obj = {
                channelId: guild,
                guild_name: detailes.guild_name,
                guildId: detailes.guildId,
                filter: detailes.filter || [""],
                blacklist: detailes.blacklist || [],
                replace: detailes.replace || {},
                add_content: detailes.add_content || null,
                suppress_embed: detailes.suppress_embed || false,
                target_discord: detailes.target_discord || [],
                target_telegram: detailes.target_telegram || [],
                target_line: detailes.target_line || [],
                type: detailes.type || "null",
            }

            await Channel.upsert(import_obj)
        }

        console.log("Completed")
    } catch (error) {
        console.log(error)
    }
}

async function _connectDB() {
    try {
        await sequelize.authenticate()
        await sequelize.sync()

        console.log("Database Connected")
    } catch (error) {
        console.log(error)
        notify("Upload | connectDB " + error.message)
    }
}

upload()