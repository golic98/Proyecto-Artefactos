const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');

const SERIAL_PORT = '/dev/ttyUSB0';
const SERIAL_BAUD = 115200; // <- IMPORTANTE: coincide con Serial.begin(115200) en el .ino
const WS_PORT = 5001;
const REOPEN_DELAY = 3000; // ms en caso de fallo del puerto serie

let lastData = null; // último estado normalizado

// Crear puerto (autoOpen: false para controlar reintentos)
let port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD, autoOpen: false });
let parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

function openPort() {
  port.open((err) => {
    if (err) {
      console.error(`[SERIAL] Error al abrir puerto ${SERIAL_PORT}:`, err.message);
      setTimeout(openPort, REOPEN_DELAY);
      return;
    }
    console.log(`[SERIAL] Puerto serie abierto en ${SERIAL_PORT} @ ${SERIAL_BAUD}`);
  });
}

openPort();

// Manejo de eventos del puerto
port.on('error', (err) => {
  console.error('[SERIAL] Error:', err.message);
});

port.on('close', () => {
  console.warn('[SERIAL] Puerto cerrado. Reintentando abrir en', REOPEN_DELAY, 'ms');
  setTimeout(() => {
    // recrear instancia por si acaso
    port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD, autoOpen: false });
    parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
    // asociar de nuevo el listener
    parser.on('data', onSerialLine);
    openPort();
  }, REOPEN_DELAY);
});

// WebSocket server
const wss = new WebSocket.Server({ port: WS_PORT }, () => {
  console.log(`[WS] Servidor WebSocket en ws://localhost:${WS_PORT}`);
});

wss.on('connection', (ws) => {
  console.log('[WS] Cliente conectado');
  // enviar último estado conocido al cliente nuevo (si existe)
  if (lastData) {
    try { ws.send(JSON.stringify(lastData)); }
    catch (e) { console.error('[WS] Error enviando lastData:', e.message); }
  }
});

// Función para parsear timestamps recibidos del Arduino
function parseTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  // si es número (segundos o ms)
  if (typeof ts === 'number') {
    let ms = ts;
    // si parece seconds (<= 1e10) convertir a ms
    if (ts < 1e12) ms = ts * 1000;
    const d = new Date(ms);
    if (isNaN(d)) return new Date().toISOString();
    return d.toISOString();
  }
  // si es string intentar parsear
  const d = new Date(ts);
  if (!isNaN(d)) return d.toISOString();
  // fallback
  return new Date().toISOString();
}

// Normalizar y sanitizar un objeto con posibles campos de sensores
function normalizeData(raw) {
  const out = {};
  out.timestamp = parseTimestamp(raw.timestamp);

  if ('rain' in raw) {
    // aceptar booleanos, 0/1, strings "0"/"1"
    const r = raw.rain;
    if (typeof r === 'boolean') out.rain = r ? 1 : 0;
    else {
      const n = Number(r);
      out.rain = Number.isFinite(n) ? (n ? 1 : 0) : (String(r).toLowerCase() === 'true' ? 1 : 0);
    }
  }

  if ('distance' in raw) {
    const n = Number(raw.distance);
    if (Number.isFinite(n)) out.distance = +n.toFixed(2);
  }

  if ('temperature' in raw) {
    const n = Number(raw.temperature);
    if (Number.isFinite(n)) out.temperature = +n.toFixed(2);
  }

  if ('humidity' in raw) {
    const n = Number(raw.humidity);
    if (Number.isFinite(n)) out.humidity = +n.toFixed(2);
  }

  if ('relay' in raw) {
    const r = raw.relay;
    if (typeof r === 'boolean') out.relay = r;
    else {
      const n = Number(r);
      out.relay = Number.isFinite(n) ? Boolean(n) : (String(r).toLowerCase() === 'true');
    }
  }

  return out;
}

// Enviar a todos los clientes WebSocket
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// Handler principal para líneas recibidas desde Arduino
function onSerialLine(line) {
  line = line.trim();
  if (!line) return;
  console.log('[SERIAL RAW]:', line);

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    console.warn('[SERIAL] JSON inválido desde Arduino:', line);
    return;
  }

  const normalized = normalizeData(parsed);
  // si normalized sólo tiene timestamp, ignorar (no hay datos útiles)
  const keys = Object.keys(normalized).filter(k => k !== 'timestamp');
  if (keys.length === 0) {
    console.warn('[SERIAL] Ningún campo de sensor reconocido en el JSON:', parsed);
    return;
  }

  lastData = normalized;
  broadcast(normalized);
  console.log('[WS] Enviado al frontend:', normalized);
}

// Asignar listener del parser
parser.on('data', onSerialLine);

// Cerrar limpio al terminar
function shutdown() {
  console.log('[SERVICE] Cerrando...');
  try { if (port.isOpen) port.close(); } catch (e) { /* ignore */ }
  try { wss.close(); } catch (e) { /* ignore */ }
  process.exit();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);