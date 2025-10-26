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
    Serial.println("Failed to read from DHT sensor!");
  } else {
    
    Serial.print("Temperature: ");
    Serial.println(temperature);
  }

  delay(5000);
}