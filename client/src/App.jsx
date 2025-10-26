import { useState, useEffect } from 'react'
import TemperatureGauge from './components/TemperatureGauge';
import LineChart from './components/LineChart';
import './App.css'

function App() {
  const [temperatureData, setTemperatureData] = useState([]);

  useEffect(() => {
    const ws = new WebSocket("ws://localhost:5001");

    ws.onopen = () => {
    console.log("Conectado a websocket");

    ws.onmessage = (event) => {
      const newData = JSON.parse(event.data);
      setTemperatureData((prevData) => [...prevData, { timestamp: newData.timestamp, value: newData.temperature }]);
      console.log(newData)
    };

    return () => {
      if(ws.readyState === WebSocket.OPEN) {
        ws.close();
        console.log("Conexión cerrada de websocket");
      }
    };
  };
  }, []);

  const latest = temperatureData.length > 0 ? temperatureData[temperatureData.length - 1] : null;

  return (
    <div className="container">
      <header>
        <h1>Sensor de Temperatura</h1>
      </header>

      <div className="sensor-data">
        <div className="sensor-data-item">
          <h2>Timestamp</h2>
          <p>{latest?.timestamp ?? '—'}</p>
        </div>

        <div className="sensor-data-item">
          <h2>Temperature</h2>
          <p>{latest ? `${latest.value} °C` : '—'}</p>
          {latest && Number.isFinite(latest.value) && (
            <TemperatureGauge value={latest.value} />
          )}
        </div>
      </div>

      <div className="charts">
        <LineChart data={temperatureData} label="Temperature" />
      </div>
    </div>
  );
}

export default App
