const { Client, Options } = require('discord.js-selfbot-v13');

const { init_channels, on_message_create } = require("./events/index")
const { notify } = require("../../shared/notification")

const { DISCORD_TOKEN } = require("../../configs/app.config")
const { READY, MESSAGE_CREATE } = require("./enums/index")

// Для user-акаунта бібліотека ігнорує intents (Client.js: intents = Intents.ALL),
// тому Discord шле події з УСІХ серверів акаунта. Кожен учасник, що засвітився
// в будь-якій події (typing, presence, повідомлення), осідав у кеші назавжди —
// саме це і було витоком пам'яті (heap-снапшоти 2025-08-07: +1000 GuildMember
// за 4 хвилини). Sweepers цього не лікували: кожен GuildMember тримає свій User.
// Тепер ці кеші просто не наповнюються. Себе лишаємо — потрібно для guild.members.me.
// GuildManager / ChannelManager / RoleManager / PermissionOverwriteManager
// бібліотека обмежувати не дозволяє — це базовий об'єм, залежить від кількості серверів.
const isSelf = (entity) => entity.id === entity.client.user?.id

const client_options = {
    checkUpdate: false,
    makeCache: Options.cacheWithLimits({
        ...Options.defaultMakeCacheSettings, // архівні треди чистяться раз на годину
        MessageManager: 0,
        // maxSize 1, а не 0: при 0 LimitedCollection ігнорує keepOverLimit.
        // З 1 у кеші лишається себе + останній запис — розмір обмежений.
        GuildMemberManager: { maxSize: 1, keepOverLimit: isSelf },
        UserManager: { maxSize: 1, keepOverLimit: isSelf },
        PresenceManager: 0,
        VoiceStateManager: 0,
        ReactionManager: 0,
        ReactionUserManager: 0,
        ThreadMemberManager: 0,
        GuildBanManager: 0,
        GuildInviteManager: 0,
        StageInstanceManager: 0,
    }),
};

const client = new Client(client_options);

let eventCounters = { messageCreate: 0, error: 0 }
let eventsAdded = false

async function login() {
    const ready = new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Login timeout")), 60000)
        client.once(READY, () => {
            clearTimeout(timeout)
            resolve()
        })
    })

    await client.login(DISCORD_TOKEN)
    await ready

    console.log(`[LOGIN] ${client.user.username} is ready! Guilds: ${client.guilds.cache.size}, channels: ${client.channels.cache.size}`)
    await notify(`Client ${client.user.username} is ready! Guilds: ${client.guilds.cache.size}`)
}

function add_events() {
    if (eventsAdded) return
    eventsAdded = true

    client.on(MESSAGE_CREATE, async (message) => {
        eventCounters.messageCreate++
        try {
            await on_message_create(message)
        } catch (error) {
            eventCounters.error++
            console.error("[EVENTS] Error in on_message_create:", error)
        }
    })

    // Постійний обробник: EventEmitter без слухача "error" валить процес
    client.on('error', (error) => {
        eventCounters.error++
        console.error("[CLIENT] Error event:", error)
    })

    client.on('shardDisconnect', (event) => console.log(`[CLIENT] Disconnected (${event?.code})`))
    client.on('shardReconnecting', () => console.log("[CLIENT] Reconnecting..."))
    client.on('shardResume', () => console.log("[CLIENT] Resumed"))
}

// Розміри кешів — головний показник, що витік зупинено
function getCacheStats() {
    let members = 0
    let messages = 0
    for (const guild of client.guilds.cache.values()) members += guild.members.cache.size
    for (const channel of client.channels.cache.values()) messages += channel.messages?.cache?.size || 0

    return {
        guilds: client.guilds.cache.size,
        channels: client.channels.cache.size,
        users: client.users.cache.size,
        members,
        messages,
    }
}

async function shutdown() {
    console.log("[SHUTDOWN] Destroying Discord client...")
    try {
        client.destroy()
        console.log("[SHUTDOWN] Discord client destroyed")
    } catch (error) {
        console.error("[SHUTDOWN] Error during shutdown:", error)
    }
}

async function launch() {
    try {
        await init_channels()
        add_events()
        await login()
        console.log("[LAUNCH] Bot launched successfully")
    } catch (error) {
        console.error("[LAUNCH] Launch error:", error)
        await notify(`Launch error: ${error.message}`)
        throw error
    }
}

module.exports = {
    login,
    launch,
    shutdown,
    getClient: () => client,
    getCacheStats,
    getEventCounters: () => ({ ...eventCounters })
};
