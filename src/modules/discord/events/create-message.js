const { webhookService } = require("../services/index")
const { Channel } = require("../../pot/models/index")

// Лічильники для статистики
let messageStats = {
    processed: 0,
    filtered: 0,
    sent: 0,
    errors: 0,
    lastReset: Date.now(),
    memoryLeaks: 0,
    cacheHits: 0,
    cacheMisses: 0
};

// Кеш для каналів з автоматичним очищенням
const channelCache = new Map();
const CACHE_TTL = 300000; // 5 хвилин
const MAX_CACHE_SIZE = 1000; // Максимальний розмір кешу
const CACHE_CLEANUP_INTERVAL = 600000; // 10 хвилин

// Кеш для webhook URL валідації (щоб не валідувати кожен раз)
const webhookValidationCache = new Map();
const WEBHOOK_VALIDATION_TTL = 1800000; // 30 хвилин

// Set для відстеження активних операцій (запобігає дублюванню)
const activeOperations = new Set();

// WeakMap для зберігання посилань на об'єкти повідомлень (автоматично очищується)
const messageReferences = new WeakMap();

// Функція для глибокого очищення об'єктів
function deepCleanObject(obj) {
    if (!obj || typeof obj !== 'object') return;
    
    try {
        // Очищуємо всі властивості об'єкта
        Object.keys(obj).forEach(key => {
            if (obj[key] && typeof obj[key] === 'object') {
                // Рекурсивно очищуємо вкладені об'єкти
                if (Array.isArray(obj[key])) {
                    obj[key].length = 0; // Очищуємо масиви
                } else {
                    deepCleanObject(obj[key]);
                }
            }
            obj[key] = null; // Обнуляємо посилання
        });
    } catch (error) {
        console.warn(`[MEMORY] Error during deep clean: ${error.message}`);
    }
}

// Покращена функція очищення кешу з детальним логуванням
function cleanupCache() {
    const startTime = Date.now();
    const initialSize = channelCache.size;
    const now = Date.now();
    let cleanedCount = 0;
    let errorCount = 0;
    
    try {
        // Очищення основного кешу каналів
        for (const [key, value] of channelCache.entries()) {
            try {
                if (!value || now - value.timestamp > CACHE_TTL) {
                    // Глибоко очищуємо дані перед видаленням
                    if (value && value.data) {
                        deepCleanObject(value.data);
                    }
                    channelCache.delete(key);
                    cleanedCount++;
                }
            } catch (error) {
                console.error(`[MEMORY] Error cleaning cache entry ${key}:`, error.message);
                channelCache.delete(key); // Видаляємо проблемний запис
                errorCount++;
            }
        }
        
        // Очищення webhook validation кешу
        let webhookCleanedCount = 0;
        for (const [key, value] of webhookValidationCache.entries()) {
            if (now - value.timestamp > WEBHOOK_VALIDATION_TTL) {
                webhookValidationCache.delete(key);
                webhookCleanedCount++;
            }
        }
        
        // Перевіряємо чи кеш не став занадто великим
        if (channelCache.size > MAX_CACHE_SIZE) {
            const overflow = channelCache.size - MAX_CACHE_SIZE;
            console.warn(`[MEMORY] Cache overflow detected: ${channelCache.size}/${MAX_CACHE_SIZE}`);
            
            // Видаляємо найстаріші записи
            const sortedEntries = Array.from(channelCache.entries())
                .sort((a, b) => (a[1].timestamp || 0) - (b[1].timestamp || 0));
            
            for (let i = 0; i < overflow; i++) {
                const [key, value] = sortedEntries[i];
                if (value && value.data) {
                    deepCleanObject(value.data);
                }
                channelCache.delete(key);
                cleanedCount++;
            }
        }
        
        const duration = Date.now() - startTime;
        const finalSize = channelCache.size;
        
        console.log(`[MEMORY] Cache cleanup completed in ${duration}ms`);
        console.log(`[MEMORY] Channels: ${initialSize} -> ${finalSize} (-${cleanedCount})`);
        console.log(`[MEMORY] Webhooks cleaned: ${webhookCleanedCount}, Errors: ${errorCount}`);
        
        // Логуємо підозрілу активність
        if (cleanedCount === 0 && initialSize > 100) {
            console.warn(`[MEMORY] Suspicious: No cache entries cleaned but size is ${initialSize}`);
            messageStats.memoryLeaks++;
        }
        
        return { cleaned: cleanedCount, webhooksCleaned: webhookCleanedCount, errors: errorCount };
        
    } catch (error) {
        console.error(`[MEMORY] Critical error in cache cleanup:`, error);
        // Аварійне очищення
        channelCache.clear();
        webhookValidationCache.clear();
        return { cleaned: initialSize, error: error.message };
    }
}

// Функція для валідації webhook URL з кешуванням
function validateWebhookUrl(url) {
    if (!url || typeof url !== 'string') return false;
    
    // Перевіряємо кеш
    const cached = webhookValidationCache.get(url);
    if (cached && Date.now() - cached.timestamp < WEBHOOK_VALIDATION_TTL) {
        return cached.isValid;
    }
    
    try {
        const urlObj = new URL(url);
        const isValid = urlObj.protocol === 'https:' && 
                       urlObj.hostname === 'discord.com' &&
                       urlObj.pathname.includes('/api/webhooks/');
        
        // Зберігаємо результат в кеші
        webhookValidationCache.set(url, {
            isValid,
            timestamp: Date.now()
        });
        
        return isValid;
    } catch (error) {
        // Зберігаємо негативний результат
        webhookValidationCache.set(url, {
            isValid: false,
            timestamp: Date.now()
        });
        return false;
    }
}

// Функція для безпечного створення операційного ID
function createOperationId(message) {
    try {
        return `${message.channelId}-${message.id || Date.now()}-${message.author?.id || 'unknown'}`;
    } catch (error) {
        return `unknown-${Date.now()}-${Math.random()}`;
    }
}

// Покращений автоматичний cleanup
setInterval(() => {
    try {
        cleanupCache();
        
        // Очищуємо активні операції (на випадок зависання)
        if (activeOperations.size > 100) {
            console.warn(`[MEMORY] Too many active operations: ${activeOperations.size}, clearing...`);
            activeOperations.clear();
        }
        
        // Форсуємо garbage collection якщо доступно
        if (global.gc && messageStats.processed % 500 === 0) {
            const beforeHeap = process.memoryUsage().heapUsed;
            global.gc();
            const afterHeap = process.memoryUsage().heapUsed;
            const freedMB = (beforeHeap - afterHeap) / (1024 ** 2);
            console.log(`[MEMORY] Forced GC freed ${freedMB.toFixed(2)} MB`);
        }
        
    } catch (error) {
        console.error(`[MEMORY] Error in automatic cleanup:`, error);
    }
}, CACHE_CLEANUP_INTERVAL);

async function on_message_create(message) {
    const startTime = Date.now();
    const operationId = createOperationId(message);
    
    // Перевіряємо чи вже обробляємо це повідомлення
    if (activeOperations.has(operationId)) {
        console.warn(`[MESSAGE] Duplicate operation detected: ${operationId}`);
        return;
    }
    
    activeOperations.add(operationId);
    
    let channelFilter = null;
    let post = null;
    let attachmentsProcessed = [];
    
    try {
        messageStats.processed++;
        
        // Детальне логування з memory usage
        const memBefore = process.memoryUsage();
        console.log(`[MESSAGE] Processing ${operationId}`);
        console.log(`[MESSAGE] Memory before: ${(memBefore.heapUsed / 1024 / 1024).toFixed(2)} MB`);
        console.log(`[MESSAGE] Channel: ${message.channelId}, Author: ${message.author?.username || 'Unknown'}, Content: ${message.content?.length || 0} chars`);
        
        // Базова валідація з детальним логуванням
        if (!message.channelId) {
            console.log("[MESSAGE] No channelId, skipping");
            return;
        }

        const hasContent = message.content && message.content.trim().length > 0;
        const hasAttachments = message.attachments && message.attachments.size > 0;
        
        if (!hasContent && !hasAttachments) {
            console.log("[MESSAGE] No content and no attachments, skipping");
            return;
        }

        // Покращена робота з кешем
        const cacheKey = message.channelId;
        const cachedData = channelCache.get(cacheKey);
        
        if (cachedData && Date.now() - cachedData.timestamp < CACHE_TTL) {
            channelFilter = cachedData.data;
            messageStats.cacheHits++;
            console.log(`[MESSAGE] Cache hit for ${message.channelId}`);
        } else {
            console.log(`[MESSAGE] Cache miss for ${message.channelId}, loading from DB`);
            messageStats.cacheMisses++;
            
            try {
                channelFilter = await Channel.findOne({ 
                    where: { channelId: message.channelId },
                    raw: true // Отримуємо простий об'єкт без Sequelize wrapper
                });
                
                // Зберігаємо в кеш з глибоким клонуванням для безпеки
                channelCache.set(cacheKey, {
                    data: channelFilter ? JSON.parse(JSON.stringify(channelFilter)) : null,
                    timestamp: Date.now()
                });
                
            } catch (dbError) {
                console.error(`[MESSAGE] Database error for ${message.channelId}:`, dbError.message);
                return;
            }
        }

        if (!channelFilter) {
            console.log(`[MESSAGE] No filter found for channel ${message.channelId}`);
            return;
        }

        console.log(`[MESSAGE] Filter found: ${channelFilter.guild_name}, keywords: ${channelFilter.filter?.length || 0}, targets: ${channelFilter.target_discord?.length || 0}`);

        // Валідація фільтрів
        if (!channelFilter.filter || !Array.isArray(channelFilter.filter) || channelFilter.filter.length === 0) {
            console.log("[MESSAGE] No keywords configured");
            messageStats.filtered++;
            return;
        }

        // Покращена перевірка ключових слів
        const keywords = channelFilter.filter.filter(k => k && typeof k === 'string' && k.trim().length > 0);
        if (keywords.length === 0) {
            console.log("[MESSAGE] No valid keywords after filtering");
            messageStats.filtered++;
            return;
        }

        const messageContent = (message.content || '').trim();
        const contentLower = messageContent.toLowerCase();
        
        const matchedKeywords = keywords.filter(keyword => {
            const keywordLower = keyword.toLowerCase();
            return contentLower.includes(keywordLower);
        });

        if (matchedKeywords.length === 0) {
            console.log(`[MESSAGE] No keyword matches in: "${messageContent.substring(0, 100)}"`);
            messageStats.filtered++;
            return;
        }

        console.log(`[MESSAGE] Keywords matched: [${matchedKeywords.join(', ')}]`);

        // Безпечне створення контенту
        let sanitized_content = messageContent
            .replace(/@here/g, 'here')
            .replace(/@everyone/g, 'everyone')
            .replace(/\x00/g, '') // Видаляємо null bytes
            .substring(0, 1900); // Обмежуємо довжину

        // Обробка embeds
        if (channelFilter.suppress_embed) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            sanitized_content = sanitized_content.replace(urlRegex, '<$1>');
        }

        // Безпечне створення об'єкта повідомлення
        post = {
            content: `## 〓 ${(channelFilter.guild_name || 'Unknown').substring(0, 100)}\n${sanitized_content}`,
            embeds: []
        };

        // Покращена обробка вкладень з обмеженням пам'яті
        if (hasAttachments && message.attachments.size > 0) {
            console.log(`[MESSAGE] Processing ${message.attachments.size} attachments`);
            
            let processedCount = 0;
            const maxAttachments = 10; // Обмежуємо кількість
            
            for (const [attachmentId, attachment] of message.attachments) {
                if (processedCount >= maxAttachments) {
                    console.warn(`[MESSAGE] Attachment limit reached (${maxAttachments}), skipping remaining`);
                    break;
                }
                
                try {
                    if (!attachment || !attachment.url) {
                        console.warn(`[MESSAGE] Invalid attachment: ${attachmentId}`);
                        continue;
                    }
                    
                    if (attachment.contentType?.startsWith('image/')) {
                        // Валідуємо URL
                        if (attachment.url.startsWith('https://cdn.discordapp.com/')) {
                            post.embeds.push({
                                title: (attachment.name || 'Image').substring(0, 100),
                                image: { url: attachment.url }
                            });
                            
                            attachmentsProcessed.push({
                                id: attachmentId,
                                name: attachment.name,
                                type: attachment.contentType,
                                size: attachment.size
                            });
                            
                            processedCount++;
                        } else {
                            console.warn(`[MESSAGE] Suspicious attachment URL: ${attachment.url.substring(0, 100)}`);
                        }
                    } else {
                        console.log(`[MESSAGE] Unsupported attachment type: ${attachment.contentType} (${attachment.name})`);
                    }
                } catch (attachmentError) {
                    console.error(`[MESSAGE] Error processing attachment ${attachmentId}:`, attachmentError.message);
                }
            }
        }

        // Валідація цілей
        if (!channelFilter.target_discord || !Array.isArray(channelFilter.target_discord) || channelFilter.target_discord.length === 0) {
            console.log("[MESSAGE] No target webhooks configured");
            return;
        }

        // Фільтруємо і валідуємо webhook URLs
        const validWebhooks = channelFilter.target_discord.filter(validateWebhookUrl);
        if (validWebhooks.length === 0) {
            console.error("[MESSAGE] No valid webhooks found");
            return;
        }

        if (validWebhooks.length !== channelFilter.target_discord.length) {
            console.warn(`[MESSAGE] Some webhooks are invalid: ${channelFilter.target_discord.length - validWebhooks.length} removed`);
        }

        console.log(`[MESSAGE] Sending to ${validWebhooks.length} webhooks, embeds: ${post.embeds.length}`);

        // Відправка з обмеженням concurrent запитів
        let successCount = 0;
        let errorCount = 0;
        const maxConcurrent = 3;
        
        for (let i = 0; i < validWebhooks.length; i += maxConcurrent) {
            const batch = validWebhooks.slice(i, i + maxConcurrent);
            
            const promises = batch.map(async (webhook_url) => {
                try {
                    await webhookService.send_webhook_message(webhook_url, post);
                    successCount++;
                    console.log(`[MESSAGE] Success: ${webhook_url.substring(0, 50)}...`);
                    return { success: true, url: webhook_url };
                } catch (webhookError) {
                    errorCount++;
                    console.error(`[MESSAGE] Webhook error ${webhook_url.substring(0, 50)}...:`, webhookError.message);
                    
                    // Видаляємо недійсні webhooks з кешу валідації
                    if (webhookError.message.includes('404') || webhookError.message.includes('Unauthorized')) {
                        webhookValidationCache.set(webhook_url, {
                            isValid: false,
                            timestamp: Date.now()
                        });
                    }
                    
                    return { success: false, url: webhook_url, error: webhookError.message };
                }
            });
            
            await Promise.all(promises);
            
            // Невелика затримка між батчами
            if (i + maxConcurrent < validWebhooks.length) {
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        messageStats.sent += successCount;
        messageStats.errors += errorCount;

        const processingTime = Date.now() - startTime;
        const memAfter = process.memoryUsage();
        const memUsed = (memAfter.heapUsed - memBefore.heapUsed) / 1024 / 1024;
        
        console.log(`[MESSAGE] Completed in ${processingTime}ms. Success: ${successCount}, Errors: ${errorCount}`);
        console.log(`[MESSAGE] Memory after: ${(memAfter.heapUsed / 1024 / 1024).toFixed(2)} MB (${memUsed > 0 ? '+' : ''}${memUsed.toFixed(2)} MB)`);
        console.log(`[MESSAGE] Attachments processed: ${attachmentsProcessed.length}`);

        // Детальне логування кожні 50 повідомлень
        if (messageStats.processed % 50 === 0) {
            const timeSinceReset = Date.now() - messageStats.lastReset;
            const cacheHitRate = messageStats.cacheHits / (messageStats.cacheHits + messageStats.cacheMisses) * 100;
            
            console.log(`[MESSAGE] === STATS REPORT ===`);
            console.log(`[MESSAGE] Processed: ${messageStats.processed}, Filtered: ${messageStats.filtered}, Sent: ${messageStats.sent}, Errors: ${messageStats.errors}`);
            console.log(`[MESSAGE] Cache: ${channelCache.size} entries, Hit rate: ${cacheHitRate.toFixed(1)}%`);
            console.log(`[MESSAGE] Memory leaks detected: ${messageStats.memoryLeaks}`);
            console.log(`[MESSAGE] Active operations: ${activeOperations.size}`);
            console.log(`[MESSAGE] Webhook validation cache: ${webhookValidationCache.size}`);
            console.log(`[MESSAGE] Time: ${(timeSinceReset / 1000).toFixed(0)}s`);
            
            // Скидаємо статистику кожні 500 повідомлень
            if (messageStats.processed % 500 === 0) {
                messageStats = {
                    processed: 0,
                    filtered: 0,
                    sent: 0,
                    errors: 0,
                    lastReset: Date.now(),
                    memoryLeaks: 0,
                    cacheHits: 0,
                    cacheMisses: 0
                };
            }
        }

    } catch (error) {
        messageStats.errors++;
        console.error(`[MESSAGE] Critical error processing ${operationId}:`, error);
        console.error(`[MESSAGE] Stack trace:`, error.stack);
        
        // Очищуємо з кешу при помилці
        if (message.channelId) {
            channelCache.delete(message.channelId);
        }
        
    } finally {
        // Активне очищення пам'яті
        try {
            // Видаляємо з активних операцій
            activeOperations.delete(operationId);
            
            // Глибоко очищуємо створені об'єкти
            if (post) {
                deepCleanObject(post);
                post = null;
            }
            
            if (attachmentsProcessed) {
                attachmentsProcessed.length = 0;
                attachmentsProcessed = null;
            }
            
            // Очищуємо посилання на channel filter якщо він не з кешу
            if (channelFilter) {
                channelFilter = null;
            }
            
            // Примусове очищення великого кешу
            if (channelCache.size > MAX_CACHE_SIZE * 1.5) {
                console.warn(`[MEMORY] Emergency cache cleanup triggered: ${channelCache.size} entries`);
                cleanupCache();
            }
            
        } catch (cleanupError) {
            console.error(`[MEMORY] Error during cleanup:`, cleanupError.message);
        }
    }
}

// Функція для отримання розширеної статистики
function getStats() {
    const cacheHitRate = messageStats.cacheHits + messageStats.cacheMisses > 0 
        ? (messageStats.cacheHits / (messageStats.cacheHits + messageStats.cacheMisses) * 100).toFixed(1)
        : 0;
        
    return {
        ...messageStats,
        cacheSize: channelCache.size,
        webhookCacheSize: webhookValidationCache.size,
        activeOperations: activeOperations.size,
        cacheHitRate: `${cacheHitRate}%`,
        uptime: Date.now() - messageStats.lastReset,
        memoryUsage: {
            heapUsed: (process.memoryUsage().heapUsed / 1024 / 1024).toFixed(2) + ' MB',
            heapTotal: (process.memoryUsage().heapTotal / 1024 / 1024).toFixed(2) + ' MB'
        }
    };
}

// Функція для аварійного очищення всього
function emergencyCleanup() {
    console.log(`[MEMORY] EMERGENCY CLEANUP INITIATED`);
    
    const beforeSize = channelCache.size + webhookValidationCache.size + activeOperations.size;
    
    // Глибоко очищуємо кеші
    for (const [key, value] of channelCache) {
        if (value && value.data) {
            deepCleanObject(value.data);
        }
    }
    
    channelCache.clear();
    webhookValidationCache.clear();
    activeOperations.clear();
    
    // Форсуємо GC
    if (global.gc) {
        global.gc();
    }
    
    console.log(`[MEMORY] Emergency cleanup completed, cleared ${beforeSize} items`);
    return beforeSize;
}

// Функція для детальної діагностики
function getDetailedDiagnostics() {
    const memory = process.memoryUsage();
    
    return {
        timestamp: new Date().toISOString(),
        memory: {
            heapUsed: `${(memory.heapUsed / 1024 / 1024).toFixed(2)} MB`,
            heapTotal: `${(memory.heapTotal / 1024 / 1024).toFixed(2)} MB`,
            external: `${(memory.external / 1024 / 1024).toFixed(2)} MB`,
            rss: `${(memory.rss / 1024 / 1024).toFixed(2)} MB`,
            arrayBuffers: `${(memory.arrayBuffers / 1024 / 1024).toFixed(2)} MB`
        },
        caches: {
            channels: {
                size: channelCache.size,
                maxSize: MAX_CACHE_SIZE,
                oldestEntry: channelCache.size > 0 ? Math.min(...Array.from(channelCache.values()).map(v => v.timestamp)) : null
            },
            webhooks: {
                size: webhookValidationCache.size,
                oldestEntry: webhookValidationCache.size > 0 ? Math.min(...Array.from(webhookValidationCache.values()).map(v => v.timestamp)) : null
            },
            activeOperations: activeOperations.size
        },
        stats: messageStats,
        performance: {
            uptime: process.uptime(),
            cpuUsage: process.cpuUsage()
        }
    };
}

module.exports = {
    on_message_create,
    getStats,
    cleanupCache,
    emergencyCleanup,
    getDetailedDiagnostics
};