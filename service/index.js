//const TelegramBot = require('node-telegram-bot-api');
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');

//const token = 'TOKEN_TELEGRAM_BOT';
const SERIAL_PORT = '/dev/ttyUSB0';
const SERIAL_BAUD = 9600;
const WS_PORT = 5001;

//const bot = new TelegramBot(token, {polling: true});
const port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD, autoOpen: false });
const parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

port.open((err) => {
  if (err) return console.error('Error al abrir puerto serie:', err.message);
  console.log(`Puerto serie abierto en ${SERIAL_PORT}`);
});

const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`Servidor WebSocket en ws://localhost:${WS_PORT}`);
});

parser.on('data', (line) => {
  line = line.trim();
  console.log('RAW desde Arduino:', line);
  try {
    const data = JSON.parse(line);
    if (data.timestamp && typeof data.timestamp === 'number') {
      data.timestamp = new Date(data.timestamp + Date.now() - data.timestamp).toISOString(); // opcional, o simplemente new Date().toISOString()
    } else {
      data.timestamp = new Date().toISOString();
    }
    const msg = JSON.stringify(data);
    wss.clients.forEach((client) => {
      if (client.readyState === WebSocket.OPEN) client.send(msg);
    });
    console.log('Enviado a frontend:', data);
  } catch (e) {
    console.log('JSON inválido desde Arduino:', line);
  }
});

//bot.on('message', (msg) => {
  //const chatId = msg.chat.id;

  //bot.sendMessage(chatId, 'Received your message');
//});