#include <DHT.h>

#define PIN_DHT 2            // Pin para el DHT22.
#define PINBOMBA 4           // Pin para la MiniBomba de agua.
#define ULTRA_TRIG 5         // PIN TRIGGER ULTRASONICO
#define ULTRA_ECHO 18        // PIN ECHO ULTRASONICO
#define DIGITALPINLLUVIA 14  // Pin digital para sensor de lluvia.
#define SENSOR1_PIN 32       // Pin 1 sensor de humedad capacitivo.
#define SENSOR2_PIN 33       // Pin 2 sensor de humedad capacitivo.
#define PINANALOGLLUVIA 36   // Pin analogico para sensor de lluvia.

#define DHTTYPE DHT22

DHT dht(PIN_DHT, DHTTYPE);

// --- Configuración ---
const bool SERIAL_DEBUG = false; // true => imprime texto humano; false => solo JSON (producción)

// Valores definidos para marcar limites en las funcionalidades.
const int VALOR_SECO = 3500;     // 0% humedad
const int VALOR_MOJADO = 1200;   // 100% humedad
const int UMBRAL_PORC_HUMEDAD = 40;    // % por debajo de esto se considera "seco"
const unsigned long TIEMPO_MAX_BOMBA_MS = 30000UL; // 30 s máxima corrida continua

// Mediciones y limites del recipiente para la funcionalidad del ultrasonico.
const float ALTURA_TANQUE_CM = 19.9;   // distancia del sensor al fondo del tanque (medir físicamente)
const float MIN_DISTANCIA_CM = 2.5;    // zona muerta del sensor (por debajo, no confiar)
const int ULTRA_SAMPLES = 5;           // lecturas para promedio (>=3 recomendado)

bool bombaActiva = false;
unsigned long bombaInicioMillis = 0;

// --- Prototipos (nuevas funciones añadidas) ---
int leerHumedadPorcentaje(int pinADC);
int leerHumedadBruto(int pinADC);
bool hayLluviaDigital();
void controlarBomba(bool encender);
void funcionalidadUltrasonico();  // utilidad para imprimir
float leerDistanciaUltrasonico(); // opcional: si conectas HC-SR04
void enviarJSON();

void setup() {
  Serial.begin(115200);
  dht.begin();
  pinMode(PINBOMBA, OUTPUT);
  pinMode(DIGITALPINLLUVIA, INPUT);
  pinMode(ULTRA_TRIG, OUTPUT);
  pinMode(ULTRA_ECHO, INPUT);
  analogSetAttenuation(ADC_11db); // permitir rango hasta ~3.3V en ADC
  digitalWrite(PINBOMBA, LOW); // asegurarnos bomba apagada al inicio
}

void loop() {
  // Lecturas e impresiones (si SERIAL_DEBUG == true)
  imprimirTemperaturaHumedad();
  funcionalidadSensorLluvia();
  funcionalidadSensoresCapacitivos();

  int hum1_pct = leerHumedadPorcentaje(SENSOR1_PIN);
  int hum2_pct = leerHumedadPorcentaje(SENSOR2_PIN);
  bool llueve = hayLluviaDigital();
  
  if (SERIAL_DEBUG) {
    Serial.print("Hum % sensor1: "); Serial.print(hum1_pct);
    Serial.print("  sensor2: "); Serial.print(hum2_pct);
    Serial.print("  Lluvia (digital DO): "); Serial.println(llueve ? "SI" : "NO");
  }

  bool sueloSeco = (hum1_pct < UMBRAL_PORC_HUMEDAD) || (hum2_pct < UMBRAL_PORC_HUMEDAD);

  if(sueloSeco && !llueve) {
    // si no está ya activa, iniciamos y guardamos el tiempo
    if(!bombaActiva) {
      if (SERIAL_DEBUG) Serial.println("Condición de riego detectada. Encendiendo bomba...");
      controlarBomba(true);
      bombaActiva = true;
      bombaInicioMillis = millis();
    } else {
      // ya estaba activa: comprobar tiempo máximo
      unsigned long ahora = millis();
      if(ahora - bombaInicioMillis >= TIEMPO_MAX_BOMBA_MS) {
        if (SERIAL_DEBUG) Serial.println("Tiempo máximo de bomba alcanzado. Apagando por seguridad.");
        controlarBomba(false);
        bombaActiva = false;
      } else {
        if (SERIAL_DEBUG) Serial.println("Bomba activa... controlando tiempo y humedad.");
        if((hum1_pct >= UMBRAL_PORC_HUMEDAD) && (hum2_pct >= UMBRAL_PORC_HUMEDAD)) {
          if (SERIAL_DEBUG) Serial.println("Humedad recuperada en ambos sensores. Apagando bomba.");
          controlarBomba(false);
          bombaActiva = false;
        }
      }
    }
  } else {
    // no debería regar: apagar bomba si estaba encendida
    if(bombaActiva) {
      if (SERIAL_DEBUG) Serial.println("Condición para apagar bomba (suelo no seco o está lloviendo). Apagando.");
      controlarBomba(false);
      bombaActiva = false;
    } else {
      if (SERIAL_DEBUG) Serial.println("No regar: suelo húmedo o está lloviendo.");
    }
  }

  // Ultrasonico (imprime solo si DEBUG)
  funcionalidadUltrasonico();

  // Enviar estado en JSON (una sola línea)
  enviarJSON();

  delay(10000);
}

void imprimirTemperaturaHumedad() {
  float h = dht.readHumidity();
  float t = dht.readTemperature(); 

  // leer de nuevo (mantener tu patrón original)
  h = dht.readHumidity();
  t = dht.readTemperature();

  if (SERIAL_DEBUG) {
    Serial.print("Humedad: ");
    Serial.print(h);
    Serial.println("%");
    Serial.print("Temperatura: ");
    Serial.print(t);
    Serial.println("°C");
  }
}

void funcionalidadSensorLluvia() {
  int valorAnalogicoLluvia = analogRead(PINANALOGLLUVIA);
  int valorDigitalLluvia = digitalRead(DIGITALPINLLUVIA);

  if (SERIAL_DEBUG) {
    Serial.print("Valor analogico: ");
    Serial.print(valorAnalogicoLluvia);
    Serial.print(" | Valor digital: ");
    Serial.println(valorDigitalLluvia);
  }
}

void funcionalidadSensoresCapacitivos() {
  int humedad1_raw = analogRead(SENSOR1_PIN);
  int humedad2_raw = analogRead(SENSOR2_PIN);

  int humedad1 = map(humedad1_raw, VALOR_SECO, VALOR_MOJADO, 0, 100);
  int humedad2 = map(humedad2_raw, VALOR_SECO, VALOR_MOJADO, 0, 100);

  humedad1 = constrain(humedad1, 0, 100);
  humedad2 = constrain(humedad2, 0, 100);

  if (SERIAL_DEBUG) {
    Serial.print("Sensor 1: ");
    Serial.print(humedad1_raw);
    Serial.print(" | ");
    Serial.print(humedad1);
    Serial.println("%");

    Serial.print("Sensor 2: ");
    Serial.print(humedad2_raw);
    Serial.print(" | ");
    Serial.print(humedad2);
    Serial.println("%");
  }
}

int leerHumedadPorcentaje(int pinADC) {
  int raw = analogRead(pinADC);
  int pct = map(raw, VALOR_SECO, VALOR_MOJADO, 0, 100);
  pct = constrain(pct, 0, 100);
  return pct;
}

int leerHumedadBruto(int pinADC) {
  return analogRead(pinADC);
}

bool hayLluviaDigital() {
  int val = digitalRead(DIGITALPINLLUVIA);
  return (val == LOW);
}

// Encender/apagar bomba directamente (usa PINBOMBA)
void controlarBomba(bool encender) {
  if (encender) {
    digitalWrite(PINBOMBA, HIGH);
  } else {
    digitalWrite(PINBOMBA, LOW);
  }
}

/* ------------------ Funciones del ultrasonico (mantengo versión estable) ------------------ */

// Lee una sola medicion del HC-SR04, devuelve distancia en cm, o -1 si timeout
float _leerDistanciaOnce() {
  digitalWrite(ULTRA_TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(ULTRA_TRIG, HIGH);
  delayMicroseconds(10);
  digitalWrite(ULTRA_TRIG, LOW);
  
  long duracion = pulseIn(ULTRA_ECHO, HIGH, 30000); // timeout 30 ms
  if (duracion == 0) return -1.0;

  float distancia = (duracion * 0.0343) / 2.0;
  return distancia;
}

// Promedia ULTRA_SAMPLES lecturas válidas; devuelve -1 si todas fallan.
float leerDistanciaUltrasonico() {
  float suma = 0.0;
  int validas = 0;
  for (int i = 0; i < ULTRA_SAMPLES; ++i) {
    float d = _leerDistanciaOnce();
    if (d > 0) {
      suma += d;
      validas++;
    }
    delay(30); // pequeña pausa entre lecturas
  }
  if (validas == 0) return -1.0;
  return suma / validas;
}

// Calcula porcentaje de llenado (0..100) a partir de la distancia medida.
// Devuelve -1 si distancia inválida.
float calcularPorcentajeNivel(float distancia_cm) {
  if (distancia_cm < 0) return -1.0;
  if (distancia_cm >= ALTURA_TANQUE_CM) return 0.0; // vacío o fuera de rango
  if (distancia_cm <= MIN_DISTANCIA_CM) return 100.0; // casi lleno
  float nivel = (ALTURA_TANQUE_CM - distancia_cm) / ALTURA_TANQUE_CM * 100.0;
  if (nivel < 0.0) nivel = 0.0;
  if (nivel > 100.0) nivel = 100.0;
  return nivel;
}

// Traduce porcentaje a estado textual
String estadoNivel(float porcentaje) {
  if (porcentaje < 0) return "ERROR: sin lectura";
  if (porcentaje <= 2.0) return "VACIO";
  if (porcentaje <= 20.0) return "MUY BAJO";
  if (porcentaje <= 50.0) return "MEDIO";
  if (porcentaje <= 95.0) return "ALTO";
  return "LLENO";
}

// Imprime distancia, porcentaje y estado del nivel (solo si SERIAL_DEBUG)
void funcionalidadUltrasonico() {
  float dist = leerDistanciaUltrasonico();
  if (dist < 0) {
    if (SERIAL_DEBUG) {
      Serial.println("Ultrasonico: sin lectura valida");
      Serial.println("Nivel agua: ERROR");
    }
    return;
  }

  float pct = calcularPorcentajeNivel(dist);

  if (SERIAL_DEBUG) {
    Serial.print("Ultrasonico - Distancia (cm): ");
    Serial.println(dist, 2);
    if (pct < 0) {
      Serial.println("Nivel agua: ERROR");
    } else {
      Serial.print("Nivel agua: ");
      Serial.print(pct, 1);
      Serial.println(" %");
      Serial.print("Estado: ");
      Serial.println(estadoNivel(pct));
    }
  }
}

/* ------------------ Envío JSON limpio ------------------ */
// Envía una única línea JSON con los campos disponibles.
// Interpreta rainDigital usando la lógica típica MH-RD (DO = LOW -> hay agua).
void enviarJSON() {
  // Lecturas
  float hum = dht.readHumidity();
  float temp = dht.readTemperature();

  int rainAnalog = analogRead(PINANALOGLLUVIA);     // 0..4095 (puede saturar si AO > 3.3V)
  int rainDigitalRaw = digitalRead(DIGITALPINLLUVIA); // 0 o 1
  bool rainDetected = (rainDigitalRaw == LOW); // true = hay agua (DO activo en bajo)

  int s1_raw = analogRead(SENSOR1_PIN);
  int s2_raw = analogRead(SENSOR2_PIN);
  int s1_pct = leerHumedadPorcentaje(SENSOR1_PIN);
  int s2_pct = leerHumedadPorcentaje(SENSOR2_PIN);
  float dist = leerDistanciaUltrasonico(); // -1 si inválida
  int relayState = digitalRead(PINBOMBA); // ajusta si tu relé es inverso

  unsigned long ts = millis() / 1000UL; // segundos desde arranque

  // Construir JSON manualmente; OMITIR campos inválidos (p. ej. distance si dist < 0)
  String json = "{";
  json += "\"timestamp\":" + String(ts) + ",";
  json += "\"temperature\":" + String(temp, 2) + ",";
  json += "\"humidity\":" + String(hum, 2) + ",";
  // rain: interpretado (1 = lluvia), y añadimos el raw digital para diagnóstico
  json += "\"rain\":" + String(rainDetected ? 1 : 0) + ",";
  json += "\"rain_digital_raw\":" + String(rainDigitalRaw) + ",";
  json += "\"rain_analog\":" + String(rainAnalog) + ",";
  json += "\"sensor1_raw\":" + String(s1_raw) + ",";
  json += "\"sensor2_raw\":" + String(s2_raw) + ",";
  json += "\"sensor1_pct\":" + String(s1_pct) + ",";
  json += "\"sensor2_pct\":" + String(s2_pct) + ",";
  json += "\"relay\":" + String(relayState ? 1 : 0);
  if (dist >= 0.0) {
    json += ",\"distance\":" + String(dist, 2);
  }
  json += "}";

  // Enviar UNA LÍNEA JSON limpia al puerto serie
  Serial.println(json);

  if (SERIAL_DEBUG) {
    Serial.print("[JSON OUT] ");
    Serial.println(json);
  }
}
