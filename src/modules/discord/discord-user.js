const { Client } = require('discord.js-selfbot-v13');

const { on_message_create } = require("./events/index")
const { notify } = require("../../shared/notification")

const { DISCORD_TOKEN } = require("../../configs/app.config")
const { READY, MESSAGE_CREATE } = require("./enums/index")

const client_options = {
    checkUpdate: true,
    sweepers: {
        // Очищення кешу для повідомлень через 30 хвилин
        messages: {
            interval: 1800, // інтервал очищення (секунди)
            lifetime: 1800, // час життя повідомлення в кеші (секунди)
        },
        // Очищення кешу каналів через 60 хвилин
        channels: {
            interval: 1800,
            lifetime: 1800,
        },
        // Очищення кешу користувачів через 24 години
        users: {
            interval: 1800,
            lifetime: 1800,
        },
        // Очищення кешу емодзі через 6 годин
        emojis: {
            interval: 1800,
            lifetime: 1800,
        },
        // Очищення кешу гільдій через 12 годин
        guilds: {
            interval: 1800,
            lifetime: 1800,
        },
    },
}

const client = new Client(client_options);

async function login() {
    return new Promise((resolve, reject) => {
        try {
            client.login(DISCORD_TOKEN);

            client.once(READY, async () => {
                console.log(`${client.user.username} is ready!`);
                notify("Client " + client.user.username + " is ready!")
                resolve()
            });

        } catch (error) {
            console.log(error)
            notify("Login " + error.message)
            reject()
        }
    })

}

async function add_events() {
    try {
        if (!client.listenerCount(MESSAGE_CREATE)) {
            client.on(MESSAGE_CREATE, on_message_create);
        }
        // client.on(MESSAGE_CREATE, on_message_create);

        console.log("Events added")
    } catch (error) {
        console.log(error)
        notify("Add_Events " + error.message)
    }
}

async function launch() {
    try {
        await login()

        await add_events()
    } catch (error) {
        console.log(error)
        notify("Launch " + error.message)
    }
}

module.exports = {
    login,
    launch
}