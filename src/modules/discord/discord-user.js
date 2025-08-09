const { Client, Intents } = require('discord.js-selfbot-v13');

const { on_message_create } = require("./events/index")
const { notify } = require("../../shared/notification")

const { DISCORD_TOKEN } = require("../../configs/app.config")
const { READY, MESSAGE_CREATE } = require("./enums/index")

const client_options = {
    intents: [
        Intents.FLAGS.GUILDS,
        Intents.FLAGS.GUILD_MESSAGES
    ],
    checkUpdate: false, // Відключаємо перевірку оновлень
    sweepers: {
        messages: {
            interval: 120, // 2 хвилини
            filter: () => (message) => Date.now() - message.createdTimestamp > 120000 // 2 хвилини
        },
        users: {
            interval: 300, // 5 хвилин
            filter: () => (user) => !user.bot && !user.system && 
                Date.now() - (user.lastMessageTimestamp || user.createdTimestamp) > 300000 // 5 хвилин без активності
        },
        emojis: {
            interval: 600, // 10 хвилин
            filter: () => (emoji) => Date.now() - emoji.createdTimestamp > 600000 // 10 хвилин
        },
        presences: {
            interval: 60, // 1 хвилина
            filter: () => (presence) => Date.now() - (presence.updatedTimestamp || 0) > 60000 // 1 хвилина
        }
    },
    // Налаштовуємо тільки sweepers, залишаючи стандартний кеш
    // makeCache можна прибрати, щоб уникнути конфліктів
    // Налаштування для мінімізації навантаження
    restTimeOffset: 500,
    restRequestTimeout: 15000,
    retryLimit: 3,
    restSweepInterval: 60,
    restGlobalTimeout: 0,
    invalidRequestWarningInterval: 0,
};

const client = new Client(client_options);

// Відстеження подій для моніторингу
let eventCounters = {
    messageCreate: 0,
    ready: 0,
    error: 0,
    disconnect: 0,
    reconnecting: 0
};

// Функція для логування статистики подій
function logEventStats() {
    console.log(`[EVENTS] Stats: messageCreate=${eventCounters.messageCreate}, ready=${eventCounters.ready}, error=${eventCounters.error}, disconnect=${eventCounters.disconnect}, reconnecting=${eventCounters.reconnecting}`);
    
    // Скидаємо лічильники кожну годину
    Object.keys(eventCounters).forEach(key => eventCounters[key] = 0);
}

async function login() {
    return new Promise((resolve, reject) => {
        const loginTimeout = setTimeout(() => {
            console.log("[LOGIN] Login timeout after 30 seconds");
            reject(new Error("Login timeout"));
        }, 30000);

        try {
            console.log("[LOGIN] Starting login process...");
            client.login(DISCORD_TOKEN);

            client.once(READY, async () => {
                clearTimeout(loginTimeout);
                eventCounters.ready++;
                
                console.log(`[LOGIN] ${client.user.username} is ready!`);
                console.log(`[LOGIN] Connected to ${client.guilds.cache.size} guilds`);
                console.log(`[LOGIN] Cached users: ${client.users.cache.size}`);
                console.log(`[LOGIN] Cached channels: ${client.channels.cache.size}`);
                
                await notify(`Client ${client.user.username} is ready! Guilds: ${client.guilds.cache.size}`);
                resolve();
            });

            // Додаємо обробники помилок
            client.once('error', (error) => {
                clearTimeout(loginTimeout);
                eventCounters.error++;
                console.error("[LOGIN] Client error:", error);
                notify(`Login error: ${error.message}`);
                reject(error);
            });

            client.once('disconnect', () => {
                clearTimeout(loginTimeout);
                eventCounters.disconnect++;
                console.log("[LOGIN] Client disconnected during login");
                reject(new Error("Disconnected during login"));
            });

        } catch (error) {
            clearTimeout(loginTimeout);
            console.error("[LOGIN] Exception during login:", error);
            notify(`Login exception: ${error.message}`);
            reject(error);
        }
    });
}

async function add_events() {
    try {
        // Перевіряємо чи вже додані слухачі
        if (!client.listenerCount(MESSAGE_CREATE)) {
            console.log("[EVENTS] Adding MESSAGE_CREATE listener");
            client.on(MESSAGE_CREATE, async (message) => {
                eventCounters.messageCreate++;
                try {
                    await on_message_create(message);
                } catch (error) {
                    console.error("[EVENTS] Error in on_message_create:", error);
                    // Не відправляємо notify для кожної помилки, щоб не заспамити
                    if (eventCounters.error % 10 === 0) {
                        await notify(`Message processing error (count: ${eventCounters.error}): ${error.message}`);
                    }
                }
            });
        }

        // Додаємо обробники інших важливих подій
        if (!client.listenerCount('error')) {
            client.on('error', (error) => {
                eventCounters.error++;
                console.error("[CLIENT] Error event:", error);
            });
        }

        if (!client.listenerCount('disconnect')) {
            client.on('disconnect', () => {
                eventCounters.disconnect++;
                console.log("[CLIENT] Disconnected");
            });
        }

        if (!client.listenerCount('reconnecting')) {
            client.on('reconnecting', () => {
                eventCounters.reconnecting++;
                console.log("[CLIENT] Reconnecting...");
            });
        }

        // Додаємо обробник для відстеження debug інформації
        if (!client.listenerCount('debug')) {
            client.on('debug', (info) => {
                // Логуємо тільки важливу debug інформацію
                if (info.includes('Heartbeat') || info.includes('Connection') || info.includes('Ready')) {
                    console.log(`[DEBUG] ${info}`);
                }
            });
        }

        console.log("[EVENTS] All events added successfully");

        // Запускаємо логування статистики подій кожну годину
        setInterval(logEventStats, 3600000); // 1 година

    } catch (error) {
        console.error("[EVENTS] Error adding events:", error);
        await notify(`Add_Events error: ${error.message}`);
        throw error;
    }
}

async function manualSweep() {
    try {
        console.log("[SWEEP] Starting manual sweep...");
        const startTime = Date.now();
        
        // Логуємо стан кешу перед очищенням
        const beforeStats = {
            messages: client.channels.cache.reduce((acc, channel) => {
                return acc + (channel.messages?.cache?.size || 0);
            }, 0),
            channels: client.channels.cache.size,
            users: client.users.cache.size,
            guilds: client.guilds.cache.size,
            emojis: client.emojis.cache.size
        };

        console.log(`[SWEEP] Before sweep - Messages: ${beforeStats.messages}, Channels: ${beforeStats.channels}, Users: ${beforeStats.users}, Guilds: ${beforeStats.guilds}, Emojis: ${beforeStats.emojis}`);

        // Виконуємо очищення - викликаємо sweep методи з фільтрами
        let sweptMessages = 0;
        let sweptChannels = 0;
        let sweptUsers = 0;
        let sweptEmojis = 0;
        let sweptGuilds = 0;

        try {
            // Очищення повідомлень
            sweptMessages = client.sweepers.messages.sweep((message) => Date.now() - message.createdTimestamp > 300000);
        } catch (error) {
            console.warn("[SWEEP] Messages sweep failed:", error.message);
        }

        try {
            // Очищення користувачів
            sweptUsers = client.sweepers.users.sweep((user) => !user.bot && Date.now() - user.createdTimestamp > 900000);
        } catch (error) {
            console.warn("[SWEEP] Users sweep failed:", error.message);
        }

        try {
            // Очищення емодзі
            if (client.emojis && client.emojis.cache) {
                const oldSize = client.emojis.cache.size;
                client.emojis.cache = client.emojis.cache.filter(emoji => 
                    Date.now() - emoji.createdTimestamp <= 1200000
                );
                sweptEmojis = oldSize - client.emojis.cache.size;
            }
        } catch (error) {
            console.warn("[SWEEP] Emojis sweep failed:", error.message);
        }

        const endTime = Date.now();
        const duration = endTime - startTime;

        console.log(`[SWEEP] Completed in ${duration}ms. Swept - Messages: ${sweptMessages}, Channels: ${sweptChannels}, Users: ${sweptUsers}, Emojis: ${sweptEmojis}, Guilds: ${sweptGuilds}`);

        // Форсуємо garbage collection якщо доступно
        if (global.gc) {
            console.log("[SWEEP] Running garbage collection...");
            global.gc();
        }

        return {
            duration,
            swept: { sweptMessages, sweptChannels, sweptUsers, sweptEmojis, sweptGuilds }
        };

    } catch (error) {
        console.error("[SWEEP] Error during manual sweep:", error);
        await notify(`Manual Sweep Error: ${error.message}`);
        throw error;
    }
}

// Функція для graceful shutdown
async function shutdown() {
    console.log("[SHUTDOWN] Starting graceful shutdown...");
    
    try {
        // Видаляємо всі слухачі подій
        client.removeAllListeners();
        
        // Очищуємо кеші
        await manualSweep();
        
        // Закриваємо з'єднання
        client.destroy();
        
        console.log("[SHUTDOWN] Graceful shutdown completed");
        await notify("Bot shutdown completed");
        
    } catch (error) {
        console.error("[SHUTDOWN] Error during shutdown:", error);
        await notify(`Shutdown error: ${error.message}`);
    }
}

async function launch() {
    try {
        console.log("[LAUNCH] Starting bot launch...");
        
        await login();
        console.log("[LAUNCH] Login completed");
        
        await add_events();
        console.log("[LAUNCH] Events added");

        // Запускаємо автоматичне очищення кожні 10 хвилин
        const sweepInterval = setInterval(async () => {
            try {
                await manualSweep();
            } catch (error) {
                console.error("[LAUNCH] Error in sweep interval:", error);
            }
        }, 600000); // 10 хвилин

        // Додаємо обробники для graceful shutdown
        process.on('SIGINT', async () => {
            console.log("[LAUNCH] Received SIGINT");
            clearInterval(sweepInterval);
            await shutdown();
            process.exit(0);
        });

        process.on('SIGTERM', async () => {
            console.log("[LAUNCH] Received SIGTERM");
            clearInterval(sweepInterval);
            await shutdown();
            process.exit(0);
        });

        console.log("[LAUNCH] Bot launched successfully");
        await notify("Bot launch completed successfully");

    } catch (error) {
        console.error("[LAUNCH] Launch error:", error);
        await notify(`Launch error: ${error.message}`);
        throw error;
    }
}

// Експортуємо додаткові функції для моніторингу
module.exports = {
    login,
    launch,
    manualSweep,
    shutdown,
    getClient: () => client,
    getEventCounters: () => ({ ...eventCounters })
};