const os = require('os');
const { execSync } = require('child_process');
const v8 = require('v8');
const fs = require('fs');
const path = require('path');
const { notify } = require("../../shared/notification");

// Функція для отримання інформації про використання ресурсів
function getResourceUsage() {
    try {
        const memoryUsage = process.memoryUsage();
        const totalMemory = os.totalmem();
        const freeMemory = os.freemem();
        const usedMemory = totalMemory - freeMemory;

        const loadAverage = os.loadavg();

        const uptime = process.uptime();
        const cpuUsage = process.cpuUsage();
        const heapUsage = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;

        return {
            totalMemory: (totalMemory / (1024 ** 2)).toFixed(2) + ' MB',
            usedMemory: (usedMemory / (1024 ** 2)).toFixed(2) + ' MB',
            freeMemory: (freeMemory / (1024 ** 2)).toFixed(2) + ' MB',
            heapUsed: (memoryUsage.heapUsed / (1024 ** 2)).toFixed(2) + ' MB',
            heapTotal: (memoryUsage.heapTotal / (1024 ** 2)).toFixed(2) + ' MB',
            heapUsagePercent: heapUsage.toFixed(2) + '%',
            loadAverage: loadAverage.map(l => l.toFixed(2)).join(', '),
            cpuUsage: (cpuUsage.user / 1e6).toFixed(2) + ' ms user, ' + (cpuUsage.system / 1e6).toFixed(2) + ' ms system',
            uptime: (uptime / 60).toFixed(2) + ' minutes'
        };
    } catch (error) {
        console.log(error);
    }
}



function createHeapSnapshot() {
    const snapshotPath = path.join(__dirname, `heap-${Date.now()}.heapsnapshot`);
    try {
        v8.writeHeapSnapshot(snapshotPath);
        console.log(`Heap snapshot saved to: ${snapshotPath}`);

        return snapshotPath;
    } catch (error) {
        console.error('Error writing heap snapshot:', error);
        return snapshotPath;
    }
}

async function checkMemoryLeaks() {
    try {
        const memoryUsage = process.memoryUsage();
        if (memoryUsage.heapUsed > memoryUsage.heapTotal * 0.8) {
            console.warn('Warning: Possible memory leak detected!');

            // const snapshotPath = createHeapSnapshot();
            // await notify(`Warning: Possible memory leak detected!\nHeap snapshot generated at: ${snapshotPath}`);
        }
    } catch (error) {
        console.log(error);
    }
}

async function sendReport() {
    try {
        const usage = getResourceUsage();
        const report = `
Resource Usage Report:
===========================
Total Memory: ${usage.totalMemory}
Used Memory: ${usage.usedMemory}
Free Memory: ${usage.freeMemory}
Heap Used: ${usage.heapUsed} / ${usage.heapTotal} (${usage.heapUsagePercent})
CPU Load: ${usage.loadAverage}
CPU Usage: ${usage.cpuUsage}
Uptime: ${usage.uptime}
===========================`;

        console.log(report);
        await notify(report);
    } catch (error) {
        console.log(error);
    }
}

function launch() {
    const monitorInterval = 60000; // Кожну хвилину

    setInterval(() => {
        sendReport();
        checkMemoryLeaks();
    }, monitorInterval);

    process.on('uncaughtException', (error) => {
        console.error('Uncaught Exception:', error);
        notify(error.message);
    });

    process.on('unhandledRejection', (reason, promise) => {
        console.error('Unhandled Rejection:', reason);
        notify(JSON.stringify(reason));
    });

    console.log('Monitoring started!');
}

module.exports = {
    launch
};