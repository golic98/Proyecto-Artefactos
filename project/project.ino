#include <DHT.h>

#define DHTPIN D5     
#define DHTTYPE DHT11   

DHT dht(DHTPIN, DHTTYPE);

void setup() {
  Serial.begin(9600);
  dht.begin();
}

void loop() {
  float temperature = dht.readTemperature();

  if (isnan(temperature)) {
    Serial.println("{\"error\":\"Failed to read from DHT sensor\"}");
  } else {
    // Enviamos JSON simple: {"temperature":32.40,"timestamp":123456}
    Serial.print("{\"temperature\":");
    Serial.print(temperature, 2);
    Serial.print(",\"timestamp\":");
    Serial.print(millis()); // o puedes usar 0 o no enviar timestamp
    Serial.println("}");
  }

  delay(5000);
}

