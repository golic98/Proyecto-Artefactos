//const TelegramBot = require('node-telegram-bot-api');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');

//const token = 'TOKEN_TELEGRAM_BOT';
const SERIAL_PORT = '/dev/ttyUSB0';
const SERIAL_BAUD = 9600;
const WS_PORT = 5001;

const port = new SerialPort({
  path: SERIAL_PORT,
  baudRate: SERIAL_BAUD,
  autoOpen: false,
});
//const bot = new TelegramBot(token, {polling: true});

const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.open((err) => {
  if (err) {
    return console.error('Error al abrir puerto serie:', err.message);
  }
  console.log(`Puerto serie abierto en ${SERIAL_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`Servidor WebSocket en ws://localhost:${WS_PORT}`);
});

parser.on('data', (line) => {
  line = line.trim();
  try {
    const data = JSON.parse(line); 
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) {
        client.send(msg);
      }
    });
    console.log('Enviado a frontend:', data);
  } catch (e) {
    console.log('Dato inválido desde Arduino:', line);
  }
});

//bot.on('message', (msg) => {
  //const chatId = msg.chat.id;

  //bot.sendMessage(chatId, 'Received your message');
//});