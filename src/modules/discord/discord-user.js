const { Client } = require('discord.js-selfbot-v13');

const { on_message_create } = require("./events/index")

const { DISCORD_TOKEN } = require("../../configs/app.config")
const { READY, MESSAGE_CREATE } = require("./enums/index")

const client = new Client({
    checkUpdate: true,
});

async function login() {
    return new Promise((resolve, reject) => {
        try {
            client.login(DISCORD_TOKEN);

            client.once(READY, async () => {
                console.log(`${client.user.username} is ready!`);
                resolve()
            });

        } catch (error) {
            console.log(error)
            reject()
        }
    })

}

async function add_events() {
    try {
        client.on(MESSAGE_CREATE, on_message_create);

        console.log("Events added")
    } catch (error) {
        console.log(error)
    }
}

async function launch() {
    try {
        await login()

        await add_events()
    } catch (error) {
        console.log(error)
    }
}

module.exports = {
    login,
    launch
}