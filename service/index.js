// server.js
const { SerialPort } = require('serialport');
const { ReadlineParser } = require('@serialport/parser-readline');
const WebSocket = require('ws');
const axios = require('axios');
require('dotenv').config();

const SERIAL_PORT = process.env.SERIAL_PORT || '/dev/ttyUSB0';
const SERIAL_BAUD = Number(process.env.SERIAL_BAUD || 115200);
const TANK_HEIGHT_CM = Number(process.env.TANK_HEIGHT_CM || 19.9); // altura total del tanque
const TANK_EMPTY_MARGIN_CM = Number(process.env.TANK_EMPTY_MARGIN_CM || 1.0); // margen: si distancia >= height - margin => vacio
const WS_PORT = Number(process.env.WS_PORT || 5001);
const REOPEN_DELAY = 3000; // ms

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN || '';
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID || '';
const NOTIFY_COOLDOWN_MS = Number(process.env.NOTIFY_COOLDOWN_MS || 60000);

if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) {
  console.log('[NOTIFY] Telegram deshabilitado: configura TELEGRAM_TOKEN y TELEGRAM_CHAT_ID en entorno.');
}

async function sendTelegramMessage(text) {
  if (!TELEGRAM_TOKEN || !TELEGRAM_CHAT_ID) return;
  try {
    const url = `https://api.telegram.org/bot${TELEGRAM_TOKEN}/sendMessage`;
    await axios.post(url, {
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown'
    });
    console.log('[NOTIFY] Mensaje enviado a Telegram');
  } catch (err) {
    console.error('[NOTIFY] Error al enviar Telegram:', err?.response?.data || err.message);
  }
}

// Anti Spam
const lastNotificationAt = {
  relay: 0,
  rain: 0,
  capacitivo: 0,
  tank: 0
};

// estado previo para detectar cambios
let lastSentData = null;
let lastData = null; // último estado normalizado

// --- WebSocket server (escucha en 0.0.0.0 para conexiones en LAN) ---
const wss = new WebSocket.Server({ port: WS_PORT, host: '0.0.0.0' }, () => {
  console.log(`[WS] Servidor WebSocket en ws://0.0.0.0:${WS_PORT}`);
});

wss.on('connection', (ws, req) => {
  const clientIP = req.socket.remoteAddress;
  console.log('[WS] Cliente conectado desde', clientIP);

  // enviar último estado conocido al cliente nuevo (si existe)
  if (lastData) {
    try { ws.send(JSON.stringify(lastData)); }
    catch (e) { console.error('[WS] Error enviando lastData:', e.message); }
  }

  // si el cliente envía JSON por WS (ej. dispositivo), lo procesamos igual que si viniera por serie
  ws.on('message', (message) => {
    let txt = message.toString();
    if (!txt || !txt.trim()) return;
    console.log('[WS RECV]:', txt);

    let parsed;
    try {
      parsed = JSON.parse(txt);
    } catch (e) {
      console.warn('[WS] JSON inválido recibido:', txt);
      return;
    }

    const normalized = normalizeData(parsed);
    const keys = Object.keys(normalized).filter(k => k !== 'timestamp');
    if (keys.length === 0) {
      console.warn('[WS] Ningún campo de sensor reconocido en el JSON:', parsed);
      return;
    }

    // actualizar estado, broadcast y notificaciones
    handleNewNormalized(normalized, 'ws');
  });

  ws.on('close', () => console.log('[WS] Cliente desconectado', clientIP));
});

// --- Broadcast a todos los clientes WS ---
function broadcast(obj) {
  const msg = JSON.stringify(obj);
  wss.clients.forEach((client) => {
    if (client.readyState === WebSocket.OPEN) {
      client.send(msg);
    }
  });
}

// --- Utilidades de parsing/normalización ---
function parseTimestamp(ts) {
  if (!ts) return new Date().toISOString();
  if (typeof ts === 'number') {
    let ms = ts;
    if (ts < 1e12) ms = ts * 1000;
    const d = new Date(ms);
    if (isNaN(d)) return new Date().toISOString();
    return d.toISOString();
  }
  const d = new Date(ts);
  if (!isNaN(d)) return d.toISOString();
  return new Date().toISOString();
}

function normalizeData(raw) {
  const out = {};
  out.timestamp = parseTimestamp(raw.timestamp);

  // lluvia (digital o numérico/booleano)
  if ('rain' in raw) {
    const r = raw.rain;
    if (typeof r === 'boolean') out.rain = r ? 1 : 0;
    else {
      const n = Number(r);
      out.rain = Number.isFinite(n) ? (n ? 1 : 0) : (String(r).toLowerCase() === 'true' ? 1 : 0);
    }
  }

  // distancia ultrasónico (numérica)
  if ('distance' in raw) {
    const n = Number(raw.distance);
    if (Number.isFinite(n)) out.distance = +n.toFixed(2);
  }

  // DHT22
  if ('temperature' in raw) {
    const n = Number(raw.temperature);
    if (Number.isFinite(n)) out.temperature = +n.toFixed(2);
  }
  if ('humidity' in raw) {
    const n = Number(raw.humidity);
    if (Number.isFinite(n)) out.humidity = +n.toFixed(2);
  }

  // Relay (si viene)
  if ('relay' in raw) {
    const r = raw.relay;
    if (typeof r === 'boolean') out.relay = r;
    else {
      const n = Number(r);
      out.relay = Number.isFinite(n) ? Boolean(n) : (String(r).toLowerCase() === 'true');
    }
  }

  // sensor capacitivo (raw y pct)
  if ('sensor1_raw' in raw) {
    const n = Number(raw.sensor1_raw);
    if (Number.isFinite(n)) out.sensor1_raw = Math.round(n);
  }
  if ('sensor2_raw' in raw) {
    const n = Number(raw.sensor2_raw);
    if (Number.isFinite(n)) out.sensor2_raw = Math.round(n);
  }
  if ('sensor1_pct' in raw) {
    const n = Number(raw.sensor1_pct);
    if (Number.isFinite(n)) out.sensor1_pct = Math.max(0, Math.min(100, +n.toFixed(1)));
  }
  if ('sensor2_pct' in raw) {
    const n = Number(raw.sensor2_pct);
    if (Number.isFinite(n)) out.sensor2_pct = Math.max(0, Math.min(100, +n.toFixed(1)));
  }

  const havePct1 = ('sensor1_pct' in out);
  const havePct2 = ('sensor2_pct' in out);
  if (havePct1 || havePct2) {
    const a = havePct1 ? out.sensor1_pct : null;
    const b = havePct2 ? out.sensor2_pct : null;
    let avg = null;
    if (a !== null && b !== null) avg = (a + b) / 2.0;
    else if (a !== null) avg = a;
    else if (b !== null) avg = b;

    if (avg !== null) {
      out.capacitivo = +avg.toFixed(1); // porcentaje promedio
      const UMBRAL_CAPACITIVO = 40;
      out.capacitivo_state = avg < UMBRAL_CAPACITIVO;
    }
  }

  // Si viene rain_digital_raw (diagnóstico), normalizamos también
  if ('rain_digital_raw' in raw) {
    const n = Number(raw.rain_digital_raw);
    if (Number.isFinite(n)) out.rain_digital_raw = n === 0 ? 0 : 1;
  }

  // dejar otros campos tal cual (si necesitas más, añadir aquí)

  return out;
}

// --- Notificaciones: detectar cambios y enviar Telegram ---
function detectAndNotify(prev, curr) {
  if (!curr) return;
  const now = Date.now();

  // 1) Relay (bomba) - si cambia entre true/false
  if ('relay' in curr) {
    const prevRelay = prev?.relay ?? null;
    const currRelay = !!curr.relay;
    if (prevRelay !== null && prevRelay !== currRelay) {
      if (now - lastNotificationAt.relay > NOTIFY_COOLDOWN_MS) {
        const action = currRelay ? 'encendida' : 'apagada';
        const txt = `💧 *Bomba* ${action}.\nHora: ${new Date(curr.timestamp).toLocaleString()}`;
        sendTelegramMessage(txt);
        lastNotificationAt.relay = now;
      }
    }
  }

  // 2) Lluvia (digital) - si cambia (0/1)
  if ('rain' in curr || 'rain_digital_raw' in curr) {
    const prevRainRaw = prev?.rain ?? prev?.rain_digital_raw ?? null;
    const currRainRaw = ('rain' in curr) ? Number(curr.rain) : ('rain_digital_raw' in curr ? Number(curr.rain_digital_raw) : null);
    if (prevRainRaw !== null && currRainRaw !== null && (Number(prevRainRaw) !== Number(currRainRaw))) {
      if (now - lastNotificationAt.rain > NOTIFY_COOLDOWN_MS) {
        const isRaining = Number(currRainRaw) === 1;
        const action = isRaining ? 'Se detectó lluvia 🌧️' : 'Se detuvo la lluvia';
        const txt = `☔ ${action}\nHora: ${new Date(curr.timestamp).toLocaleString()}`;
        sendTelegramMessage(txt);
        lastNotificationAt.rain = now;
      }
    }
  }

  // 3) Capacitivo (humedad del suelo) - usar capacitivo_state si existe
  if ('capacitivo_state' in curr || 'capacitivo' in curr) {
    const prevCapState = prev?.capacitivo_state ?? null;
    const currCapState = ('capacitivo_state' in curr) ? !!curr.capacitivo_state
      : (('capacitivo' in curr) ? (Number(curr.capacitivo) < 40) : null);

    if (prevCapState !== null && currCapState !== null && prevCapState !== currCapState) {
      if (now - lastNotificationAt.capacitivo > NOTIFY_COOLDOWN_MS) {
        const action = currCapState ? 'Suelo SECO (necesita riego) 🌱' : 'Suelo OK (no riego)';
        const pctInfo = ('capacitivo' in curr) ? `\nHumedad promedio: ${curr.capacitivo}%` : '';
        const txt = `🌾 ${action}${pctInfo}\nHora: ${new Date(curr.timestamp).toLocaleString()}`;
        sendTelegramMessage(txt);
        lastNotificationAt.capacitivo = now;
      }
    }
  }
}

// Detecta tanque vacío a partir de la lectura 'distance' (cm)
// Debe estar definida a nivel de módulo (no dentro de otra función)
function detectTankEmpty(prev, curr) {
  try {
    if (!curr || !('distance' in curr)) return;

    const now = Date.now();
    const dist = Number(curr.distance); // distancia sensor->superficie
    if (!Number.isFinite(dist)) return;

    // Si la distancia es mayor o igual a (altura del tanque - margen) lo consideramos VACIO
    const threshold = TANK_HEIGHT_CM - TANK_EMPTY_MARGIN_CM;
    const isEmptyNow = dist >= threshold;

    // estado previo (si existía)
    const prevEmpty = (prev && ('distance' in prev)) ? (Number(prev.distance) >= threshold) : null;

    // si prevEmpty es null (no teníamos lectura previa) no notificamos la primera vez
    if (prevEmpty === null) {
      return;
    }

    // si hubo cambio de estado y cooldown pasado -> notificar
    if (prevEmpty !== isEmptyNow) {
      if (now - lastNotificationAt.tank > NOTIFY_COOLDOWN_MS) {
        const msg = isEmptyNow
          ? `🚱 *Tanque vacío* detectado.\nDistancia medida: ${dist.toFixed(2)} cm\nHora: ${new Date(curr.timestamp).toLocaleString()}`
          : `💧 *Tanque ya tiene agua*.\nDistancia medida: ${dist.toFixed(2)} cm\nHora: ${new Date(curr.timestamp).toLocaleString()}`;

        sendTelegramMessage(msg);
        lastNotificationAt.tank = now;
      }
    }
  } catch (e) {
    console.error('[NOTIFY] Error en detectTankEmpty:', e.message);
  }
}

// Centraliza el manejo después de normalizar (serie o ws)
function handleNewNormalized(normalized, source = 'serial') {
  lastData = normalized;
  broadcast(normalized);
  console.log(`[WS] Broadcast desde ${source}:`, normalized);

  // detectar cambios y notificar (compara con lastSentData)
  try {
    detectAndNotify(lastSentData, normalized);
  } catch (e) {
    console.error('[NOTIFY] Error en detectAndNotify:', e.message);
  }

  // detectar tanque vacío por ultrasonico
  try {
    detectTankEmpty(lastSentData, normalized);
  } catch (e) {
    console.error('[NOTIFY] Error en detectTankEmpty:', e.message);
  }

  // actualizar lastSentData
  lastSentData = normalized;
}

// --- Serial handling (opcional) ---
let port = null;
let parser = null;

function startSerialIfConfigured() {
  if (!SERIAL_PORT) {
    console.log('[SERIAL] SERIAL_PORT vacío, se omite lectura por puerto serie.');
    return;
  }

  port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD, autoOpen: false });
  parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));

  parser.on('data', onSerialLine);

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

  port.on('error', (err) => {
    console.error('[SERIAL] Error:', err.message);
  });

  port.on('close', () => {
    console.warn('[SERIAL] Puerto cerrado. Reintentando abrir en', REOPEN_DELAY, 'ms');
    setTimeout(() => {
      try { port = new SerialPort({ path: SERIAL_PORT, baudRate: SERIAL_BAUD, autoOpen: false }); }
      catch (e) { console.error('[SERIAL] Error recreando puerto:', e.message); return; }
      parser = port.pipe(new ReadlineParser({ delimiter: '\n' }));
      parser.on('data', onSerialLine);
      openPort();
    }, REOPEN_DELAY);
  });

  openPort();
}

function onSerialLine(line) {
  line = line.trim();
  if (!line) return;
  console.log('[SERIAL RAW]:', line);

  let parsed;
  try {
    parsed = JSON.parse(line);
  } catch (e) {
    console.warn('[SERIAL] JSON inválido desde dispositivo serie:', line);
    return;
  }

  const normalized = normalizeData(parsed);
  const keys = Object.keys(normalized).filter(k => k !== 'timestamp');
  if (keys.length === 0) {
    console.warn('[SERIAL] Ningún campo de sensor reconocido en el JSON:', parsed);
    return;
  }

  handleNewNormalized(normalized, 'serial');
}

// start serial if SERIAL_PORT configurado
startSerialIfConfigured();

// --- graceful shutdown ---
function shutdown() {
  console.log('[SERVICE] Cerrando...');
  try { if (port && port.isOpen) port.close(); } catch (e) { /* ignore */ }
  try { wss.close(() => console.log('[WS] Cerrado')); } catch (e) { /* ignore */ }
  process.exit();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
