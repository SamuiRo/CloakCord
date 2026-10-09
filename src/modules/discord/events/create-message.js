const { webhookService } = require("../services/index")
const { Channel } = require("../../pot/models/index")

// Усі налаштовані канали тримаємо в пам'яті: їх десятки, а повідомлень
// з усіх серверів акаунта — тисячі за годину. Запит у БД на кожне
// повідомлення не потрібен, достатньо періодично перечитувати таблицю,
// щоб підхопити зміни з upload.js без перезапуску.
const CHANNELS_REFRESH_INTERVAL = 300000 // 5 хвилин
let channels = new Map()
let refreshTimer = null

// seen — повідомлення з відстежуваних каналів (до фільтра ключових слів).
// seen=0 при живих events означає, що канали недоступні акаунту, а не що фільтр суворий.
let stats = { seen: 0, matched: 0, sent: 0, errors: 0 }

async function load_channels() {
    // Без raw: true — інакше SQLite віддає JSON-колонки (filter, target_discord) рядком
    const rows = (await Channel.findAll()).map(r => r.get({ plain: true }))
    const next = new Map()

    for (const row of rows) {
        const keywords = (row.filter || [])
            .filter(k => typeof k === "string" && k.trim().length > 0)
            .map(k => k.toLowerCase())

        next.set(row.channelId, {
            guild_name: row.guild_name || "Unknown",
            keywords,
            suppress_embed: Boolean(row.suppress_embed),
            target_discord: Array.isArray(row.target_discord) ? row.target_discord : [],
        })
    }

    channels = next
    return channels.size
}

async function init_channels() {
    const count = await load_channels()
    console.log(`[MESSAGE] Watching ${count} channels`)

    if (refreshTimer) return // повторний launch після рестарту не плодить таймери

    refreshTimer = setInterval(async () => {
        try {
            await load_channels()
        } catch (error) {
            // Лишаємо попередній набір каналів, якщо БД тимчасово недоступна
            console.error("[MESSAGE] Channels refresh failed:", error.message)
        }
    }, CHANNELS_REFRESH_INTERVAL)
    refreshTimer.unref()
}

function build_post(message, channel) {
    let content = (message.content || "")
        .replace(/@here/g, "here")
        .replace(/@everyone/g, "everyone")

    if (channel.suppress_embed) {
        content = content.replace(/(https?:\/\/[^\s]+)/g, "<$1>")
    }

    const header = `## 〓 ${channel.guild_name}\n`
    // Ліміт Discord — 2000 символів на повідомлення
    content = content.substring(0, 2000 - header.length)

    const post = { content: header + content, embeds: [] }

    for (const attachment of message.attachments.values()) {
        if (post.embeds.length >= 10) break // ліміт Discord — 10 embeds

        if (attachment.contentType?.startsWith("image/")) {
            post.embeds.push({
                title: (attachment.name || "Image").substring(0, 100),
                image: { url: attachment.url }
            })
        }
    }

    return post
}

async function on_message_create(message) {
    const channel = channels.get(message.channelId)
    if (!channel) return // канал не відстежується — найчастіший випадок, без логів

    const content = message.content || ""
    const hasAttachments = message.attachments?.size > 0
    if (!content.trim() && !hasAttachments) return

    stats.seen++

    // Порожній фільтр (за замовчуванням [""]) означає «пересилати все» —
    // так працювало до v1.6.0, де includes("") завжди давав true.
    const contentLower = content.toLowerCase()
    const forwardAll = channel.keywords.length === 0
    if (!forwardAll && !channel.keywords.some(k => contentLower.includes(k))) return

    stats.matched++
    console.log(`[MESSAGE] Match in ${channel.guild_name} (${message.channelId}), targets: ${channel.target_discord.length}`)

    const post = build_post(message, channel)

    for (const webhook of channel.target_discord) {
        try {
            await webhookService.send_webhook_message(webhook, post)
            stats.sent++
        } catch (error) {
            stats.errors++
            console.error(`[MESSAGE] Webhook error (${message.channelId}):`, error.message)
        }
    }
}

function getStats() {
    return { channels: channels.size, ...stats }
}

function getWatchedChannelIds() {
    return [...channels.keys()]
}

module.exports = {
    init_channels,
    on_message_create,
    getStats,
    getWatchedChannelIds
}
