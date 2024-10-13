const DiscordUser = require("./src/modules/discord/discord-user")

async function main() {
    try {
        await DiscordUser.launch()

    } catch (error) {
        console.log(error)
    }
}

main()