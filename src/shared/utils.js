const fs = require('fs').promises;

async function check_and_create_file(filePath, data = "") {
    try {
        await fs.access(filePath);
        console.log('Файл вже існує:', filePath);
    } catch (error) {
        if (error.code === 'ENOENT') {
            // Якщо файл не існує, створюємо його
            await fs.writeFile(filePath, data, 'utf8');
            console.log('Файл створено:', filePath);
        } else {
            console.error('Сталася помилка:', error);
            throw error;
        }
    }
}

module.exports = {
    check_and_create_file
}