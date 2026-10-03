const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const { notify } = require("../../shared/notification");
const { MEMORY_ALERT_MB } = require("../../configs/app.config");

// Моніторинг свідомо простий: рядок [MEMSTAT] у лог раз на 10 хвилин,
// короткий звіт у Telegram раз на годину, тривога при перевищенні RSS.
// Автоматичних heap-снапшотів більше немає: кожен займав ~230 МБ на диску,
// на час запису подвоював пам'ять процесу і містив токен акаунта.
// heapUsed/heapTotal як метрика витоку не годиться — V8 тримає heapTotal
// впритул до heapUsed, тому відсоток майже завжди високий. Дивимось на RSS.
const STAT_INTERVAL = 600000; // 10 хвилин
const REPORT_INTERVAL = 3600000; // 1 година
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');

const timers = [];
const startTime = Date.now();
let lastAlertAt = 0;

const mb = (bytes) => (bytes / 1048576).toFixed(1);

function collect() {
    // Лінивий require: монітор стартує раніше за Discord-клієнт
    const DiscordUser = require("../discord/discord-user");
    const { getStats } = require("../discord/events/index");
    const memory = process.memoryUsage();

    return {
        uptimeMin: ((Date.now() - startTime) / 60000).toFixed(0),
        rss: mb(memory.rss),
        heapUsed: mb(memory.heapUsed),
        external: mb(memory.external),
        rssBytes: memory.rss,
        cache: DiscordUser.getCacheStats(),
        events: DiscordUser.getEventCounters(),
        messages: getStats(),
    };
}

function format(s) {
    const c = s.cache;
    return `uptime=${s.uptimeMin}m rss=${s.rss}MB heap=${s.heapUsed}MB ext=${s.external}MB | ` +
        `guilds=${c.guilds} channels=${c.channels} members=${c.members} users=${c.users} msgs=${c.messages} | ` +
        `events=${s.events.messageCreate} matched=${s.messages.matched} sent=${s.messages.sent} errors=${s.messages.errors + s.events.error}`;
}

async function logStat() {
    try {
        const s = collect();
        console.log(`[MEMSTAT] ${format(s)}`);

        const rssMB = s.rssBytes / 1048576;
        if (rssMB > MEMORY_ALERT_MB && Date.now() - lastAlertAt > REPORT_INTERVAL) {
            lastAlertAt = Date.now();
            await notify(`⚠️ CC memory: RSS ${s.rss} MB > ${MEMORY_ALERT_MB} MB\n${format(s)}`);
        }
    } catch (error) {
        console.error('[MONITOR] Stat error:', error.message);
    }
}

async function sendReport() {
    try {
        await notify(`📊 CC | ${format(collect())}`);
    } catch (error) {
        console.error('[MONITOR] Report error:', error.message);
    }
}

// Лише для ручної діагностики. Файл містить усю пам'ять процесу, разом із токеном.
function createHeapSnapshot() {
    fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return v8.writeHeapSnapshot(path.join(SNAPSHOT_DIR, `heap-${timestamp}.heapsnapshot`));
}

function launch() {
    if (timers.length) return;
    console.log(`[MONITOR] Started: [MEMSTAT] every ${STAT_INTERVAL / 60000} min, report every ${REPORT_INTERVAL / 60000} min, alert above ${MEMORY_ALERT_MB} MB RSS`);
    timers.push(setInterval(logStat, STAT_INTERVAL));
    timers.push(setInterval(sendReport, REPORT_INTERVAL));
}

function stop() {
    timers.forEach(clearInterval);
    timers.length = 0;
}

module.exports = {
    launch,
    stop,
    collect,
    createHeapSnapshot,
};
