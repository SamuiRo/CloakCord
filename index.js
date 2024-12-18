const DiscordUser = require("./src/modules/discord/discord-user")
const { notify } = require("./src/shared/notification")
const sequelize = require("./src/modules/pot/sqlite_db")
const Monitor = require("./src/modules/resource_manager/monitor")

async function main() {
    try {
        Monitor.launch()
        await _connectDB()

        await DiscordUser.launch()

        await notify("CC | Main Launch")
    } catch (error) {
        console.log(error)
        notify("Main " + error.message)
    }
}

async function _connectDB() {
    try {
        await sequelize.authenticate()
        await sequelize.sync()

        console.log("Database Connected")
    } catch (error) {
        console.log(error)
        notify("connectDB " + error.message)
    }
}

main()