const TelegramBot = require('node-telegram-bot-api');

const token = 'TOKEN_TELEGRAM_BOT';

const bot = new TelegramBot(token, {polling: true});

bot.on('message', (msg) => {
  const chatId = msg.chat.id;

  bot.sendMessage(chatId, 'Received your message');
});