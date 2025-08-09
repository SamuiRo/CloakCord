const os = require('os');
const { execSync } = require('child_process');
const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const { notify } = require("../../shared/notification");

// Константи для моніторингу
const MEMORY_LEAK_THRESHOLD = 0.85; // 85% використання heap
const CRITICAL_MEMORY_THRESHOLD = 0.95; // 95% критичний рівень
const SNAPSHOT_DIR = path.join(__dirname, 'snapshots');
const MAX_SNAPSHOTS = 5; // Максимальна кількість snapshot'ів

// History для відстеження тенденцій
let memoryHistory = [];
let cpuHistory = [];
let messageHistory = [];
const HISTORY_SIZE = 60; // Зберігаємо останні 60 записів (1 година при інтервалі 1 хвилина)

// Лічильники для статистики
let monitorStats = {
    checksPerformed: 0,
    memoryWarnings: 0,
    snapshotsCreated: 0,
    lastReportTime: Date.now(),
    startTime: Date.now()
};

// Створюємо директорію для snapshot'ів
if (!fs.existsSync(SNAPSHOT_DIR)) {
    try {
        fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
        console.log(`[MONITOR] Created snapshots directory: ${SNAPSHOT_DIR}`);
    } catch (error) {
        console.error(`[MONITOR] Failed to create snapshots directory:`, error);
    }
}

// Функція для отримання детальної інформації про використання ресурсів
function getResourceUsage() {
    try {
        const memoryUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;

        const loadAverage = os.loadavg();
        const uptime = process.uptime();
        const cpuUsage = process.cpuUsage();
        
        // Розраховуємо відсотки
        const heapUsagePercent = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
        const systemMemoryPercent = (usedMemory / totalMemory) * 100;
        const freeMemoryPercent = (freeMemory / totalMemory) * 100;

        // V8 статистика
        const heapStats = v8.getHeapStatistics();
        const heapSpaceStats = v8.getHeapSpaceStatistics();

        const resourceData = {
            // Системна пам'ять
            totalMemory: (totalMemory / (1024 ** 3)).toFixed(2) + ' GB',
            usedMemory: (usedMemory / (1024 ** 3)).toFixed(2) + ' GB',
            freeMemory: (freeMemory / (1024 ** 3)).toFixed(2) + ' GB',
            systemMemoryPercent: systemMemoryPercent.toFixed(2) + '%',
            
            // Process пам'ять
            heapUsed: (memoryUsage.heapUsed / (1024 ** 2)).toFixed(2) + ' MB',
            heapTotal: (memoryUsage.heapTotal / (1024 ** 2)).toFixed(2) + ' MB',
            heapUsagePercent: heapUsagePercent.toFixed(2) + '%',
            rss: (memoryUsage.rss / (1024 ** 2)).toFixed(2) + ' MB',
            external: (memoryUsage.external / (1024 ** 2)).toFixed(2) + ' MB',
            arrayBuffers: (memoryUsage.arrayBuffers / (1024 ** 2)).toFixed(2) + ' MB',
            
            // V8 статистика
            totalHeapSize: (heapStats.total_heap_size / (1024 ** 2)).toFixed(2) + ' MB',
            totalHeapSizeExecutable: (heapStats.total_heap_size_executable / (1024 ** 2)).toFixed(2) + ' MB',
            totalPhysicalSize: (heapStats.total_physical_size / (1024 ** 2)).toFixed(2) + ' MB',
            totalAvailableSize: (heapStats.total_available_size / (1024 ** 2)).toFixed(2) + ' MB',
            usedHeapSize: (heapStats.used_heap_size / (1024 ** 2)).toFixed(2) + ' MB',
            heapSizeLimit: (heapStats.heap_size_limit / (1024 ** 2)).toFixed(2) + ' MB',
            mallocedMemory: (heapStats.malloced_memory / (1024 ** 2)).toFixed(2) + ' MB',
            peakMallocedMemory: (heapStats.peak_malloced_memory / (1024 ** 2)).toFixed(2) + ' MB',
            numberOfNativeContexts: heapStats.number_of_native_contexts,
            numberOfDetachedContexts: heapStats.number_of_detached_contexts,
            
            // CPU і система
            loadAverage: loadAverage.map(l => l.toFixed(2)).join(', '),
            cpuUsage: {
                user: (cpuUsage.user / 1e6).toFixed(2) + ' ms',
                system: (cpuUsage.system / 1e6).toFixed(2) + ' ms',
                total: ((cpuUsage.user + cpuUsage.system) / 1e6).toFixed(2) + ' ms'
            },
            uptime: (uptime / 60).toFixed(2) + ' minutes',
            
            // Числові значення для історії
            _raw: {
                heapUsagePercent,
                systemMemoryPercent,
                heapUsedMB: memoryUsage.heapUsed / (1024 ** 2),
                heapTotalMB: memoryUsage.heapTotal / (1024 ** 2),
                rssMB: memoryUsage.rss / (1024 ** 2),
                loadAvg1: loadAverage[0],
                cpuTotalMs: (cpuUsage.user + cpuUsage.system) / 1e6
            }
        };

        return resourceData;
    } catch (error) {
        console.error('[MONITOR] Error getting resource usage:', error);
        return null;
    }
}

// Функція для створення heap snapshot
function createHeapSnapshot() {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const snapshotPath = path.join(SNAPSHOT_DIR, `heap-${timestamp}.heapsnapshot`);
    
    try {
        console.log(`[MONITOR] Creating heap snapshot...`);
        v8.writeHeapSnapshot(snapshotPath);
        
        // Отримуємо розмір файлу
        const stats = fs.statSync(snapshotPath);
        const fileSizeMB = (stats.size / (1024 ** 2)).toFixed(2);
        
        console.log(`[MONITOR] Heap snapshot created: ${snapshotPath} (${fileSizeMB} MB)`);
        monitorStats.snapshotsCreated++;
        
        // Очищуємо старі snapshot'и
        cleanupOldSnapshots();
        
        return { path: snapshotPath, size: fileSizeMB };
    } catch (error) {
        console.error('[MONITOR] Error creating heap snapshot:', error);
        return null;
    }
}

// Функція для очищення старих snapshot'ів
function cleanupOldSnapshots() {
    try {
        const files = fs.readdirSync(SNAPSHOT_DIR)
            .filter(file => file.endsWith('.heapsnapshot'))
            .map(file => ({
                name: file,
                path: path.join(SNAPSHOT_DIR, file),
                mtime: fs.statSync(path.join(SNAPSHOT_DIR, file)).mtime
            }))
            .sort((a, b) => b.mtime - a.mtime);

        if (files.length > MAX_SNAPSHOTS) {
            const filesToDelete = files.slice(MAX_SNAPSHOTS);
            filesToDelete.forEach(file => {
                try {
                    fs.unlinkSync(file.path);
                    console.log(`[MONITOR] Deleted old snapshot: ${file.name}`);
                } catch (deleteError) {
                    console.error(`[MONITOR] Error deleting snapshot ${file.name}:`, deleteError);
                }
            });
        }
    } catch (error) {
        console.error('[MONITOR] Error cleaning up snapshots:', error);
    }
}

// Функція для аналізу тенденцій пам'яті
function analyzeMemoryTrends() {
    if (memoryHistory.length < 5) return null;

    const recent = memoryHistory.slice(-5);
    const older = memoryHistory.slice(-10, -5);
    
    if (older.length === 0) return null;

    const recentAvg = recent.reduce((sum, val) => sum + val, 0) / recent.length;
    const olderAvg = older.reduce((sum, val) => sum + val, 0) / older.length;
    
    const trend = ((recentAvg - olderAvg) / olderAvg) * 100;
    
    return {
        recentAvg: recentAvg.toFixed(2),
        olderAvg: olderAvg.toFixed(2),
        trend: trend.toFixed(2),
        isIncreasing: trend > 5, // Більше 5% зростання
        isRapidIncrease: trend > 15 // Більше 15% зростання
    };
}

// Функція для перевірки витоків пам'яті
async function checkMemoryLeaks() {
    try {
        const usage = getResourceUsage();
        if (!usage) return;

        const heapPercent = usage._raw.heapUsagePercent;
        const heapUsedMB = usage._raw.heapUsedMB;
        
        // Додаємо до історії
        memoryHistory.push(heapPercent);
        if (memoryHistory.length > HISTORY_SIZE) {
            memoryHistory = memoryHistory.slice(-HISTORY_SIZE);
        }

        console.log(`[MONITOR] Memory check - Heap: ${heapPercent.toFixed(2)}%, Used: ${heapUsedMB.toFixed(2)} MB`);

        // Аналізуємо тенденції
        const trends = analyzeMemoryTrends();
        
        // Критичний рівень пам'яті
        if (heapPercent > CRITICAL_MEMORY_THRESHOLD * 100) {
            const snapshot = createHeapSnapshot();
            const message = `🚨 CRITICAL MEMORY ALERT!\nHeap usage: ${heapPercent.toFixed(2)}%\nUsed: ${heapUsedMB.toFixed(2)} MB\nSnapshot: ${snapshot ? snapshot.path : 'Failed to create'}`;
            console.error(`[MONITOR] ${message}`);
            await notify(message);
            monitorStats.memoryWarnings++;
            return;
        }

        // Попередження про витік пам'яті
        if (heapPercent > MEMORY_LEAK_THRESHOLD * 100) {
            let message = `⚠️ Memory leak warning!\nHeap usage: ${heapPercent.toFixed(2)}%\nUsed: ${heapUsedMB.toFixed(2)} MB`;
            
            if (trends) {
                message += `\nTrend: ${trends.trend}% (${trends.isIncreasing ? 'increasing' : 'stable'})`;
                
                if (trends.isRapidIncrease) {
                    message += '\n🔥 RAPID INCREASE DETECTED!';
                    const snapshot = createHeapSnapshot();
                    if (snapshot) {
                        message += `\nSnapshot created: ${snapshot.size} MB`;
                    }
                }
            }
            
            console.warn(`[MONITOR] ${message}`);
            
            // Відправляємо повідомлення тільки при швидкому зростанні або кожні 10 попереджень
            if (!trends || trends.isRapidIncrease || monitorStats.memoryWarnings % 10 === 0) {
                await notify(message);
            }
            
            monitorStats.memoryWarnings++;
        }
        
    } catch (error) {
        console.error('[MONITOR] Error checking memory leaks:', error);
    }
}

// Функція для відправки детального звіту
async function sendDetailedReport() {
    try {
        const usage = getResourceUsage();
        if (!usage) return;

        // Отримуємо статистику від інших модулів якщо доступна
        let additionalStats = '';
        try {
            // Спробуємо отримати статистику від create-message
            const { getStats } = require('./create-message');
            const messageStats = getStats();
            additionalStats += `\n📊 Message Stats:
- Processed: ${messageStats.processed}
- Filtered: ${messageStats.filtered}  
- Sent: ${messageStats.sent}
- Errors: ${messageStats.errors}
- Cache size: ${messageStats.cacheSize}
- Uptime: ${(messageStats.uptime / 60000).toFixed(2)} min`;
        } catch (error) {
            // Модуль може бути недоступний
        }

        try {
            // Спробуємо отримати статистику від discord клієнта
            const { getEventCounters } = require('./discord-user');
            const eventStats = getEventCounters();
            additionalStats += `\n🎯 Event Stats:
- Messages: ${eventStats.messageCreate}
- Errors: ${eventStats.error}
- Disconnects: ${eventStats.disconnect}
- Reconnects: ${eventStats.reconnecting}`;
        } catch (error) {
            // Модуль може бути недоступний
        }

        const trends = analyzeMemoryTrends();
        const monitorUptime = (Date.now() - monitorStats.startTime) / 60000;

        const report = `
📊 Detailed Resource Report
===========================
⏱️ System Info:
- Monitor uptime: ${monitorUptime.toFixed(2)} min
- Process uptime: ${usage.uptime}
- Checks performed: ${monitorStats.checksPerformed}
- Memory warnings: ${monitorStats.memoryWarnings}
- Snapshots created: ${monitorStats.snapshotsCreated}

🖥️ System Memory:
- Total: ${usage.totalMemory}
- Used: ${usage.usedMemory} (${usage.systemMemoryPercent})
- Free: ${usage.freeMemory}

💾 Process Memory:
- Heap Used: ${usage.heapUsed} / ${usage.heapTotal} (${usage.heapUsagePercent})
- RSS: ${usage.rss}
- External: ${usage.external}
- Array Buffers: ${usage.arrayBuffers}

🔧 V8 Engine:
- Total Heap: ${usage.totalHeapSize}
- Physical Size: ${usage.totalPhysicalSize}
- Available: ${usage.totalAvailableSize}
- Heap Limit: ${usage.heapSizeLimit}
- Native Contexts: ${usage.numberOfNativeContexts}
- Detached Contexts: ${usage.numberOfDetachedContexts}

⚡ Performance:
- CPU Load: ${usage.loadAverage}
- CPU Usage: ${usage.cpuUsage.total}
${trends ? `- Memory Trend: ${trends.trend}% (${trends.isIncreasing ? '📈 increasing' : '📊 stable'})` : ''}
${additionalStats}
===========================`;

        console.log(report);
        await notify(report);
        
        monitorStats.checksPerformed++;
        
    } catch (error) {
        console.error('[MONITOR] Error sending detailed report:', error);
        await notify(`Report error: ${error.message}`);
    }
}

// Функція для швидкого звіту
async function sendQuickReport() {
    try {
        const usage = getResourceUsage();
        if (!usage) return;

        const report = `🔍 Quick Status: Heap ${usage.heapUsagePercent} | RAM ${usage.systemMemoryPercent} | Load ${usage.loadAverage} | Uptime ${usage.uptime}`;
        
        console.log(`[MONITOR] ${report}`);
        // Не відправляємо notify для швидких звітів щоб не спамити
        
    } catch (error) {
        console.error('[MONITOR] Error sending quick report:', error);
    }
}

// Функція для force garbage collection
function forceGarbageCollection() {
    try {
        if (global.gc) {
            console.log('[MONITOR] Running manual garbage collection...');
            const beforeHeap = process.memoryUsage().heapUsed;
            global.gc();
            const afterHeap = process.memoryUsage().heapUsed;
            const freedMB = (beforeHeap - afterHeap) / (1024 ** 2);
            console.log(`[MONITOR] GC completed. Freed: ${freedMB.toFixed(2)} MB`);
            return freedMB;
        } else {
            console.log('[MONITOR] Garbage collection not available. Start with --expose-gc flag.');
            return 0;
        }
    } catch (error) {
        console.error('[MONITOR] Error during garbage collection:', error);
        return 0;
    }
}

// Головна функція моніторингу
function launch() {
    console.log('[MONITOR] Starting enhanced monitoring system...');
    
    const quickInterval = 60000;  // 1 хвилина для швидких перевірок
    const detailedInterval = 600000; // 10 хвилин для детальних звітів
    const gcInterval = 300000; // 5 хвилин для GC

    // Швидкі перевірки кожну хвилину
    const quickTimer = setInterval(async () => {
        await sendQuickReport();
        await checkMemoryLeaks();
    }, quickInterval);

    // Детальні звіти кожні 10 хвилин
    const detailedTimer = setInterval(async () => {
        await sendDetailedReport();
    }, detailedInterval);

    // Принудовий garbage collection кожні 5 хвилин
    const gcTimer = setInterval(() => {
        forceGarbageCollection();
    }, gcInterval);

    // Обробники помилок
    process.on('uncaughtException', async (error) => {
        console.error('[MONITOR] Uncaught Exception:', error);
        const usage = getResourceUsage();
        const message = `🚨 Uncaught Exception!\nError: ${error.message}\nHeap: ${usage ? usage.heapUsagePercent : 'unknown'}\nStack: ${error.stack?.substring(0, 500)}`;
        await notify(message);
        
        // Створюємо snapshot при критичних помилках
        createHeapSnapshot();
    });

    process.on('unhandledRejection', async (reason, promise) => {
        console.error('[MONITOR] Unhandled Rejection:', reason);
        const usage = getResourceUsage();
        const message = `⚠️ Unhandled Rejection!\nReason: ${JSON.stringify(reason)?.substring(0, 200)}\nHeap: ${usage ? usage.heapUsagePercent : 'unknown'}`;
        await notify(message);
    });

    // Обробник для graceful shutdown
    const shutdown = async () => {
        console.log('[MONITOR] Shutting down monitoring system...');
        clearInterval(quickTimer);
        clearInterval(detailedTimer);
        clearInterval(gcTimer);
        
        await notify('Monitoring system shut down');
        console.log('[MONITOR] Monitoring system stopped');
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    console.log('[MONITOR] Enhanced monitoring started!');
    console.log(`[MONITOR] Quick checks every ${quickInterval/1000}s, detailed reports every ${detailedInterval/1000}s`);
    
    // Відправляємо початковий звіт
    setTimeout(sendDetailedReport, 5000);
}

// Функції для ручного управління
function getMonitorStats() {
    return {
        ...monitorStats,
        memoryHistorySize: memoryHistory.length,
        cpuHistorySize: cpuHistory.length,
        uptime: Date.now() - monitorStats.startTime
    };
}

function clearHistory() {
    const cleared = {
        memory: memoryHistory.length,
        cpu: cpuHistory.length,
        messages: messageHistory.length
    };
    
    memoryHistory = [];
    cpuHistory = [];
    messageHistory = [];
    
    console.log(`[MONITOR] Cleared history: ${JSON.stringify(cleared)}`);
    return cleared;
}

module.exports = {
    launch,
    getResourceUsage,
    createHeapSnapshot,
    forceGarbageCollection,
    getMonitorStats,
    clearHistory,
    checkMemoryLeaks,
    sendDetailedReport
};