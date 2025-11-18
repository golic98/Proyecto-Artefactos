#include <DHT.h>

#define PIN_SENSOR_LLUVIA 34       // Sensor de lluvia (analógico)
#define PIN_SENSOR_HUMEDAD_SUELO 35 // Sensor capacitivo (analógico)
#define PIN_TRIGGER_ULTRASONICO 5   // Trigger del sensor ultrasónico
#define PIN_ECHO_ULTRASONICO 18     // Echo del sensor ultrasónico
#define PIN_RELE 23                 // Relé que controla la bomba
#define PIN_BOTON_MANUAL 19         // Botón para riego manual
#define PIN_BOTON_AUTO 21           // Botón para modo automático
#define PIN_DHT 4                   // Sensor DHT22

#define DHTTYPE DHT22
DHT dht(PIN_DHT, DHTTYPE);

bool modoAutomatico = true;      
unsigned long tiempoUltimoRiego = 0;
const unsigned long intervaloRiego = 60000;
const int umbralHumedadSuelo = 40;   
const int umbralNivelBajo = 20;      
const int umbralLluvia = 500;        

void leerSensores();
float leerHumedadSuelo();
float leerNivelTanque();
bool detectarLluvia();
void controlarRiego();
void iniciarRiego();
void detenerRiego();
void mostrarDatos();
void verificarBotones();

float humedadAmbiente = 0;
float temperatura = 0;
float humedadSuelo = 0;
float nivelTanque = 0;
bool estaLloviendo = false;

void setup() {
  Serial.begin(115200);
  pinMode(PIN_RELE, OUTPUT);
  pinMode(PIN_BOTON_MANUAL, INPUT_PULLUP);
  pinMode(PIN_BOTON_AUTO, INPUT_PULLUP);
  pinMode(PIN_TRIGGER_ULTRASONICO, OUTPUT);
  pinMode(PIN_ECHO_ULTRASONICO, INPUT);
  
  digitalWrite(PIN_RELE, HIGH);
  dht.begin();

  Serial.println("=== SISTEMA DE RIEGO AUTOMATIZADO INICIADO ===");
}

void loop() {
  verificarBotones();
  leerSensores();
  mostrarDatos();

  if (modoAutomatico) {
    controlarRiego();
  }

  delay(2000); 
}

void leerSensores() {
  humedadAmbiente = dht.readHumidity();
  temperatura = dht.readTemperature();
  humedadSuelo = leerHumedadSuelo();
  nivelTanque = leerNivelTanque();
  estaLloviendo = detectarLluvia();
}

float leerHumedadSuelo() {
  int valor = analogRead(PIN_SENSOR_HUMEDAD_SUELO);
  float humedad = map(valor, 4095, 0, 0, 100);
  return constrain(humedad, 0, 100);
}

float leerNivelTanque() {
  digitalWrite(PIN_TRIGGER_ULTRASONICO, LOW);
  delayMicroseconds(2);
  digitalWrite(PIN_TRIGGER_ULTRASONICO, HIGH);
  delayMicroseconds(10);
  digitalWrite(PIN_TRIGGER_ULTRASONICO, LOW);

  long duracion = pulseIn(PIN_ECHO_ULTRASONICO, HIGH);
  float distancia = duracion * 0.034 / 2; 
  return distancia;
}

bool detectarLluvia() {
  int valor = analogRead(PIN_SENSOR_LLUVIA);
  return (valor < umbralLluvia);
}

void controlarRiego() {
  unsigned long tiempoActual = millis();

  if (tiempoActual - tiempoUltimoRiego > intervaloRiego) {
    tiempoUltimoRiego = tiempoActual;

    if (humedadSuelo < umbralHumedadSuelo && !estaLloviendo && nivelTanque > umbralNivelBajo) {
      iniciarRiego();
      delay(10000);
      detenerRiego();
    } else {
      detenerRiego();
    }
  }
}

void iniciarRiego() {
  digitalWrite(PIN_RELE, LOW); 
  Serial.println("Riego iniciado...");
}

void detenerRiego() {
  digitalWrite(PIN_RELE, HIGH);
  Serial.println("Riego detenido.");
}

void mostrarDatos() {
  Serial.println("---- ESTADO DEL SISTEMA ----");
  Serial.print("Temperatura: "); Serial.print(temperatura); Serial.println(" °C");
  Serial.print("Humedad ambiente: "); Serial.print(humedadAmbiente); Serial.println(" %");
  Serial.print("Humedad del suelo: "); Serial.print(humedadSuelo); Serial.println(" %");
  Serial.print("Nivel del tanque: "); Serial.print(nivelTanque); Serial.println(" cm");
  Serial.print("Lluvia: "); Serial.println(estaLloviendo ? "Sí" : "No");
  Serial.print("Modo: "); Serial.println(modoAutomatico ? "Automático" : "Manual");
  Serial.println("-----------------------------\n");
}

void verificarBotones() {
  if (digitalRead(PIN_BOTON_MANUAL) == LOW) {
    modoAutomatico = false;
    iniciarRiego();
  }

  if (digitalRead(PIN_BOTON_AUTO) == LOW) {
    modoAutomatico = true;
    detenerRiego();
  }
}
