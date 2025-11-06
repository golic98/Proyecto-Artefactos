import { useState, useEffect } from 'react';
import TemperatureGauge from './components/TemperatureGauge';
import LineChart from './components/LineChart';
import './App.css';

function App() {
  const [rainData, setRainData] = useState([]);
  const [ultrasonicData, setUltrasonicData] = useState([]);
  const [dht22Data, setDht22Data] = useState([]);
  const [relayState, setRelayState] = useState(null);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5001");

    ws.onopen = () => {
      console.log("Conectado a WebSocket");
    };

    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      console.log("Datos recibidos:", data);

      if ('rain' in data) {
        setRainData(prev => [...prev, { timestamp: data.timestamp, value: data.rain }]);
      }
      if ('distance' in data) {
        setUltrasonicData(prev => [...prev, { timestamp: data.timestamp, value: data.distance }]);
      }
      if ('temperature' in data && 'humidity' in data) {
        setDht22Data(prev => [...prev, {
          timestamp: data.timestamp,
          temperature: data.temperature,
          humidity: data.humidity
        }]);
      }
      if ('relay' in data) {
        setRelayState(data.relay);
      }
    };

    ws.onclose = () => {
      console.log("Conexión WebSocket cerrada");
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []);

  const latestRain = rainData.at(-1);
  const latestDistance = ultrasonicData.at(-1);
  const latestDht = dht22Data.at(-1);

  return (
    <div className="container">
      <header>
        <h1>Panel de Sensores</h1>
      </header>

      <div className="sensor-grid">

        <div className="sensor-card">
          <h2>Sensor de Lluvia</h2>
          <p>Estado: {latestRain ? (latestRain.value ? 'Lluvia detectada' : 'Sin lluvia') : '—'}</p>
          <LineChart data={rainData} label="Lluvia (1=Lluvia, 0=Seco)" />
        </div>

        <div className="sensor-card">
          <h2>Sensor Ultrasónico</h2>
          <p>Distancia: {latestDistance ? `${latestDistance.value.toFixed(2)} cm` : '—'}</p>
          <LineChart data={ultrasonicData} label="Distancia (cm)" />
        </div>

        <div className="sensor-card">
          <h2>Sensor DHT22</h2>
          <p>Temperatura: {latestDht ? `${latestDht.temperature.toFixed(1)} °C` : '—'}</p>
          <p>Humedad: {latestDht ? `${latestDht.humidity.toFixed(1)} %` : '—'}</p>
          {latestDht && <TemperatureGauge value={latestDht.temperature} />}
          <LineChart
            data={dht22Data.map(d => ({ timestamp: d.timestamp, value: d.temperature }))}
            label="Temperatura (°C)"
          />
          <LineChart
            data={dht22Data.map(d => ({ timestamp: d.timestamp, value: d.humidity }))}
            label="Humedad (%)"
          />
        </div>

        <div className="sensor-card">
          <h2>Relé 5VDC</h2>
          <p>Estado: {relayState === null ? '—' : relayState ? 'Encendido' : 'Apagado'}</p>
        </div>

      </div>
    </div>
  );
}

export default App;
