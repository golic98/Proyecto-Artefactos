import { useState, useEffect } from 'react';
import TemperatureGauge from './components/TemperatureGauge';
import LineChart from './components/LineChart';
import './App.css';

function App() {
  const [rainData, setRainData] = useState([]);
  const [ultrasonicData, setUltrasonicData] = useState([]);
  const [dht22Data, setDht22Data] = useState([]);
  const [capacitivoPctData, setCapacitivoPctData] = useState([]); // historial % humedad suelo
  const [capacitivoState, setCapacitivoState] = useState(null); // último % (number) o null
  const [needsIrrigation, setNeedsIrrigation] = useState(null); // booleano basado en capacitivo_state

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5001");

    ws.onopen = () => {
      console.log("Conectado a WebSocket");
    };

    ws.onmessage = (event) => {
      let data;
      try {
        data = JSON.parse(event.data);
      } catch (e) {
        console.warn("WS: JSON inválido recibido", event.data);
        return;
      }
      console.log("Datos recibidos:", data);

      // lluvia (0/1)
      if ('rain' in data) {
        setRainData(prev => [...prev, { timestamp: data.timestamp, value: data.rain }]);
      }

      // distancia ultrasónico
      if ('distance' in data) {
        setUltrasonicData(prev => [...prev, { timestamp: data.timestamp, value: data.distance }]);
      }

      // DHT22
      if ('temperature' in data && 'humidity' in data) {
        setDht22Data(prev => [...prev, {
          timestamp: data.timestamp,
          temperature: data.temperature,
          humidity: data.humidity
        }]);
      }

      // sensores capacitivos: prioridad a 'capacitivo' (promedio %), si no existe usar sensor1_pct/sensor2_pct
      if ('capacitivo' in data) {
        const pct = Number(data.capacitivo);
        if (!Number.isNaN(pct)) {
          setCapacitivoPctData(prev => [...prev, { timestamp: data.timestamp, value: pct }]);
          setCapacitivoState(pct);
        }
      } else {
        // fallback: si vienen sensor1_pct / sensor2_pct, calcular promedio en frontend
        const s1 = ('sensor1_pct' in data) ? Number(data.sensor1_pct) : NaN;
        const s2 = ('sensor2_pct' in data) ? Number(data.sensor2_pct) : NaN;
        if (!Number.isNaN(s1) || !Number.isNaN(s2)) {
          const values = [];
          if (!Number.isNaN(s1)) values.push(s1);
          if (!Number.isNaN(s2)) values.push(s2);
          const avg = values.reduce((a,b)=>a+b,0) / values.length;
          setCapacitivoPctData(prev => [...prev, { timestamp: data.timestamp, value: avg }]);
          setCapacitivoState(avg);
        }
      }

      // estado booleano (si viene)
      if ('capacitivo_state' in data) {
        setNeedsIrrigation(Boolean(data.capacitivo_state));
      } else {
        // si no viene, derivamos del porcentaje (umbral 40%)
        if (capacitivoState !== null) {
          setNeedsIrrigation(capacitivoState < 40);
        }
      }
    };

    ws.onclose = () => {
      console.log("Conexión WebSocket cerrada");
    };

    ws.onerror = (err) => {
      console.error("WebSocket error:", err);
    };

    return () => {
      if (ws.readyState === WebSocket.OPEN) ws.close();
    };
  }, []); // efecto solo una vez

  const latestRain = rainData.at(-1);
  const latestDistance = ultrasonicData.at(-1);
  const latestDht = dht22Data.at(-1);
  const latestCap = capacitivoPctData.at(-1);

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
          <h2>Sensor de humedad del suelo</h2>
          <p>Humedad promedio: {latestCap ? `${latestCap.value.toFixed(1)} %` : '—'}</p>
          <p>Estado: {needsIrrigation === null ? '—' : (needsIrrigation ? 'SECO (Necesita riego)' : 'OK')}</p>
          <LineChart data={capacitivoPctData} label="Humedad Suelo (%)" />
        </div>

      </div>
    </div>
  );
}

export default App;
