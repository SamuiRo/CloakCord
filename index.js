const DiscordUser = require("./src/modules/discord/discord-user")
const { notify } = require("./src/shared/notification")

async function main() {
    try {
        await DiscordUser.launch()

        await notify("CC | Main Launch")
    } catch (error) {
        console.log(error)
        notify("Main " + error.message)
    }
}

main()