const DiscordUser = require("./src/modules/discord/discord-user");
const { notify } = require("./src/shared/notification");
const sequelize = require("./src/modules/pot/sqlite_db");
const Monitor = require("./src/modules/resource_manager/monitor");

// Глобальні змінні для відстеження стану
let isShuttingDown = false;
let restartAttempts = 0;
const MAX_RESTART_ATTEMPTS = 3;
const RESTART_DELAY = 30000; // 30 секунд
const SHUTDOWN_TIMEOUT = 15000; // 15 секунд таймаут для shutdown
const NOTIFICATION_QUEUE = [];
let isProcessingNotifications = false;

// Функція для логування з часовими мітками
function logWithTimestamp(message, level = "INFO") {
  const timestamp = new Date().toISOString();
  console.log(`[${timestamp}] [${level}] ${message}`);
}

// Покращена система нотифікацій з чергою та rate limiting
async function safeNotify(message, priority = "normal") {
  return new Promise((resolve) => {
    NOTIFICATION_QUEUE.push({ message, priority, resolve });
    processNotificationQueue();
  });
}

async function processNotificationQueue() {
  if (isProcessingNotifications || NOTIFICATION_QUEUE.length === 0) {
    return;
  }

  isProcessingNotifications = true;

  while (NOTIFICATION_QUEUE.length > 0) {
    const { message, priority, resolve } = NOTIFICATION_QUEUE.shift();

    try {
      // Для критичних повідомлень під час shutdown - пропускаємо затримку
      if (priority !== "critical" && !isShuttingDown) {
        await new Promise((r) => setTimeout(r, 1000)); // 1 секунда між повідомленнями
      }

      await notify(message);
      logWithTimestamp(`Notification sent: ${message}`);
      resolve();
    } catch (error) {
      logWithTimestamp(`Notification failed: ${error.message}`, "WARN");
      resolve(); // Не блокуємо інші нотифікації через помилку
    }

    // Якщо shutdown в процесі, обробляємо тільки критичні повідомлення
    if (isShuttingDown && priority !== "critical") {
      break;
    }
  }

  isProcessingNotifications = false;
}

async function main() {
  try {
    logWithTimestamp("=== STARTING MAIN APPLICATION ===");

    // Запускаємо монітор ресурсів
    logWithTimestamp("Launching resource monitor...");
    Monitor.launch();

    // Підключаємося до бази даних
    logWithTimestamp("Connecting to database...");
    await _connectDB();

    // Запускаємо Discord клієнт
    logWithTimestamp("Launching Discord client...");
    await DiscordUser.launch();

    // Встановлюємо обробники для graceful shutdown
    setupGracefulShutdown();

    logWithTimestamp("=== APPLICATION STARTED SUCCESSFULLY ===");
    safeNotify("CC | Main Launch - SUCCESS", "normal");

    // Скидаємо лічильник спроб перезапуску при успішному запуску
    restartAttempts = 0;
  } catch (error) {
    logWithTimestamp(`Main launch error: ${error.message}`, "ERROR");
    logWithTimestamp(error.stack, "ERROR");

    safeNotify(`Main Launch ERROR: ${error.message}`, "normal");

    // Спроба перезапуску
    await handleRestart(error);
  }
}

async function _connectDB() {
  const maxRetries = 3;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      logWithTimestamp(
        `Database connection attempt ${retryCount + 1}/${maxRetries}`
      );

      await sequelize.authenticate();
      logWithTimestamp("Database authentication successful");

      await sequelize.sync();
      logWithTimestamp("Database synchronization successful");

      logWithTimestamp("Database Connected Successfully");
      return;
    } catch (error) {
      retryCount++;
      logWithTimestamp(
        `Database connection failed (attempt ${retryCount}): ${error.message}`,
        "ERROR"
      );

      if (retryCount >= maxRetries) {
        throw new Error(
          `Database connection failed after ${maxRetries} attempts: ${error.message}`
        );
      }

      // Експоненціальна затримка
      const delay = Math.min(1000 * Math.pow(2, retryCount), 10000);
      logWithTimestamp(`Waiting ${delay}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

async function handleRestart(error) {
  if (isShuttingDown) {
    logWithTimestamp("Shutdown in progress, skipping restart", "WARN");
    return;
  }

  restartAttempts++;

  if (restartAttempts > MAX_RESTART_ATTEMPTS) {
    logWithTimestamp(
      `Maximum restart attempts (${MAX_RESTART_ATTEMPTS}) exceeded. Shutting down.`,
      "ERROR"
    );
    safeNotify(
      `CRITICAL: Max restart attempts exceeded. Last error: ${error.message}`,
      "critical"
    );

    // Даємо час для відправки критичного повідомлення
    setTimeout(() => process.exit(1), 2000);
    return;
  }

  logWithTimestamp(
    `Restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS} in ${RESTART_DELAY}ms`,
    "WARN"
  );
  safeNotify(
    `Restart attempt ${restartAttempts}/${MAX_RESTART_ATTEMPTS}: ${error.message}`,
    "normal"
  );

  // Очищуємо ресурси перед перезапуском
  try {
    if (DiscordUser.getClient && DiscordUser.getClient()) {
      await DiscordUser.shutdown();
    }
  } catch (shutdownError) {
    logWithTimestamp(
      `Error during restart cleanup: ${shutdownError.message}`,
      "ERROR"
    );
  }

  setTimeout(async () => {
    try {
      await main();
    } catch (restartError) {
      logWithTimestamp(`Restart failed: ${restartError.message}`, "ERROR");
      await handleRestart(restartError);
    }
  }, RESTART_DELAY);
}

function setupGracefulShutdown() {
  const gracefulShutdown = async (signal) => {
    if (isShuttingDown) {
      logWithTimestamp(`Already shutting down, ignoring ${signal}`, "WARN");
      return;
    }

    isShuttingDown = true;
    logWithTimestamp(`=== GRACEFUL SHUTDOWN INITIATED (${signal}) ===`);

    // Встановлюємо таймаут для примусового завершення
    const forceShutdownTimer = setTimeout(() => {
      logWithTimestamp("Force shutdown due to timeout", "ERROR");
      process.exit(1);
    }, SHUTDOWN_TIMEOUT);

    try {
      const shutdownPromises = [];

      // Зупиняємо Discord клієнт
      if (DiscordUser.shutdown) {
        logWithTimestamp("Shutting down Discord client...");
        shutdownPromises.push(
          Promise.race([
            DiscordUser.shutdown(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Discord shutdown timeout")),
                5000
              )
            ),
          ]).catch((error) => {
            logWithTimestamp(
              `Discord shutdown error: ${error.message}`,
              "WARN"
            );
          })
        );
      }

      // Закриваємо з'єднання з базою даних
      if (sequelize && sequelize.close) {
        logWithTimestamp("Closing database connection...");
        shutdownPromises.push(
          Promise.race([
            sequelize.close(),
            new Promise((_, reject) =>
              setTimeout(
                () => reject(new Error("Database close timeout")),
                3000
              )
            ),
          ]).catch((error) => {
            logWithTimestamp(`Database close error: ${error.message}`, "WARN");
          })
        );
      }

      // Зупиняємо монітор ресурсів
      if (Monitor && Monitor.stop) {
        logWithTimestamp("Stopping resource monitor...");
        try {
          Monitor.stop();
        } catch (error) {
          logWithTimestamp(`Monitor stop error: ${error.message}`, "WARN");
        }
      }

      // Чекаємо завершення всіх операцій
      await Promise.allSettled(shutdownPromises);

      logWithTimestamp("=== GRACEFUL SHUTDOWN COMPLETED ===");

      // Відправляємо останнє повідомлення з високим пріоритетом
      try {
        await Promise.race([
          safeNotify("Application shutdown completed", "critical"),
          new Promise((_, reject) =>
            setTimeout(
              () => reject(new Error("Final notification timeout")),
              3000
            )
          ),
        ]);
      } catch (error) {
        logWithTimestamp(`Final notification failed: ${error.message}`, "WARN");
      }

      clearTimeout(forceShutdownTimer);
      process.exit(0);
    } catch (shutdownError) {
      logWithTimestamp(
        `Error during graceful shutdown: ${shutdownError.message}`,
        "ERROR"
      );

      try {
        await Promise.race([
          safeNotify(`Shutdown error: ${shutdownError.message}`, "critical"),
          new Promise((resolve) => setTimeout(resolve, 2000)),
        ]);
      } catch (notifyError) {
        logWithTimestamp(
          `Error notification failed: ${notifyError.message}`,
          "WARN"
        );
      }

      clearTimeout(forceShutdownTimer);
      process.exit(1);
    }
  };

  // Обробники сигналів
  process.on("SIGINT", () => gracefulShutdown("SIGINT"));
  process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));

  // Обробка необроблених помилок
  process.on("unhandledRejection", async (reason, promise) => {
    logWithTimestamp(
      `Unhandled Rejection at: ${promise}, reason: ${reason}`,
      "ERROR"
    );

    if (!isShuttingDown) {
      safeNotify(`Unhandled Rejection: ${reason}`, "normal");
      setTimeout(() => gracefulShutdown("UNHANDLED_REJECTION"), 1000);
    }
  });

  process.on("uncaughtException", async (error) => {
    logWithTimestamp(`Uncaught Exception: ${error.message}`, "ERROR");
    logWithTimestamp(error.stack, "ERROR");

    if (!isShuttingDown) {
      safeNotify(`Uncaught Exception: ${error.message}`, "normal");
      setTimeout(() => gracefulShutdown("UNCAUGHT_EXCEPTION"), 1000);
    }
  });

  // Обробник для Windows
  if (process.platform === "win32") {
    const rl = require("readline").createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.on("SIGINT", () => {
      process.emit("SIGINT");
    });
  }
}

// Функція для отримання статусу
function getApplicationStatus() {
  return {
    isShuttingDown,
    restartAttempts,
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    timestamp: new Date().toISOString(),
    notificationQueueLength: NOTIFICATION_QUEUE.length,
  };
}

// Експортуємо функції для зовнішнього використання
module.exports = {
  main,
  getApplicationStatus,
  shutdown: () => setupGracefulShutdown(),
};

// Запуск програми
if (require.main === module) {
  main().catch(async (error) => {
    logWithTimestamp(`Fatal startup error: ${error.message}`, "ERROR");
    safeNotify(`FATAL: ${error.message}`, "critical");

    // Даємо час для відправки критичного повідомлення
    setTimeout(() => process.exit(1), 2000);
  });
}
