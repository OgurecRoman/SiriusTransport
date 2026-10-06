import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, FileUp, Gauge, MapPin, Radio, RefreshCw, Search, TrainFront } from "lucide-react";
import L from "leaflet";
import "./styles.css";
import "leaflet/dist/leaflet.css";

type FileSummary = {
  id: string;
  name: string;
  status: string;
  readings_count: number;
  events_count: number;
  parse_errors_count: number;
};

type TelemetryEvent = {
  type: string;
  severity: "info" | "warning" | "critical";
  ts_start: string;
  ts_end: string;
  payload_json: Record<string, unknown>;
  explanation: string;
};

type ContextReading = {
  timestamp?: string;
  latitude?: number;
  longitude?: number;
  speed?: number;
  fsm_state?: string;
  [key: string]: unknown;
};

const API = "http://127.0.0.1:8000/api";

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function MapReplay({ fileId, event }: { fileId: string; event: TelemetryEvent }) {
  const mapElement = useRef<HTMLDivElement | null>(null);
  const map = useRef<L.Map | null>(null);
  const marker = useRef<L.CircleMarker | null>(null);
  const [readings, setReadings] = useState<ContextReading[]>([]);
  const [cursor, setCursor] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setCursor(0);
    const loadContext = async () => {
      const query = new URLSearchParams({ at: event.ts_start, before: "30", after: "30" });
      const response = await fetch(`${API}/files/${fileId}/context?${query.toString()}`);
      if (response.ok) setReadings((await response.json()) as ContextReading[]);
    };
    void loadContext();
  }, [event, fileId]);

  const points = useMemo(() => readings.filter((reading): reading is ContextReading & { latitude: number; longitude: number } => (
    typeof reading.latitude === "number" && typeof reading.longitude === "number" &&
    Number.isFinite(reading.latitude) && Number.isFinite(reading.longitude) &&
    reading.latitude !== 0 && reading.longitude !== 0
  )), [readings]);

  useEffect(() => {
    if (!mapElement.current || points.length === 0) return;
    if (!map.current) {
      map.current = L.map(mapElement.current, { zoomControl: false }).setView([points[0].latitude, points[0].longitude], 15);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current);
    }
    const line = L.polyline(points.map((point): [number, number] => [point.latitude, point.longitude]), { color: "#d9f99d", weight: 4, opacity: 0.85 }).addTo(map.current);
    map.current.fitBounds(line.getBounds(), { padding: [22, 22] });
    marker.current = L.circleMarker([points[0].latitude, points[0].longitude], { radius: 8, color: "#101517", weight: 3, fillColor: "#ff836d", fillOpacity: 1 }).addTo(map.current);
    return () => { line.remove(); marker.current?.remove(); marker.current = null; };
  }, [points]);

  useEffect(() => {
    if (!playing || points.length < 2) return;
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= points.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [playing, points.length]);

  useEffect(() => {
    const point = points[cursor];
    if (point && marker.current && map.current) {
      marker.current.setLatLng([point.latitude, point.longitude]);
      map.current.panTo([point.latitude, point.longitude], { animate: true, duration: 0.35 });
    }
  }, [cursor, points]);

  return <div className="map-wrap"><div className="map-canvas" ref={mapElement} />{points.length === 0 ? <div className="map-empty"><MapPin size={20} />Нет валидных координат для этого события</div> : <div className="map-controls"><button onClick={() => setPlaying((value) => !value)}>{playing ? "Пауза" : "Воспроизвести"}</button><button onClick={() => { setPlaying(false); setCursor(0); }}>Сбросить</button><span>{points[cursor]?.speed !== undefined ? `${Number(points[cursor].speed).toFixed(1)} км/ч` : "скорость не указана"}</span></div>}</div>;
}

function App() {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileSummary | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent | null>(null);
  const [severity, setSeverity] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadFiles = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${API}/files`);
      if (!response.ok) throw new Error("API недоступен");
      const nextFiles = (await response.json()) as FileSummary[];
      setFiles(nextFiles);
      if (!selectedFile && nextFiles.length > 0) setSelectedFile(nextFiles[0]);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить файлы");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFiles(); }, []);

  useEffect(() => {
    if (!selectedFile) return;
    const loadEvents = async () => {
      const response = await fetch(`${API}/files/${selectedFile.id}/events`);
      if (response.ok) setEvents((await response.json()) as TelemetryEvent[]);
    };
    void loadEvents();
  }, [selectedFile]);

  const visibleEvents = useMemo(() => events.filter((event) => {
    const matchesSeverity = severity === "all" || event.severity === severity;
    const haystack = `${event.type} ${event.explanation}`.toLowerCase();
    return matchesSeverity && haystack.includes(search.toLowerCase());
  }), [events, search, severity]);

  const upload = async (file: File) => {
    const form = new FormData();
    form.append("file", file);
    const response = await fetch(`${API}/files`, { method: "POST", body: form });
    if (!response.ok) throw new Error("Не удалось загрузить файл");
    await loadFiles();
  };

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span className="brand-mark"><TrainFront size={19} /></span><span>TRAM / SCOPE</span></div>
        <div className="side-heading"><span>ФАЙЛЫ ТЕЛЕМЕТРИИ</span><span className="count">{files.length}</span></div>
        <label className="upload-button"><FileUp size={16} /> Загрузить поток<input type="file" accept=".jsonseq,.json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></label>
        <div className="file-list">
          {files.map((file) => <button className={`file-item ${selectedFile?.id === file.id ? "active" : ""}`} key={file.id} onClick={() => setSelectedFile(file)}><span className={`status-dot ${file.status}`} /><span className="file-copy"><strong>{file.name}</strong><small>{file.status} · {file.events_count} событий</small></span></button>)}
          {files.length === 0 && <div className="empty-side">Загрузите JSON-поток, чтобы начать анализ.</div>}
        </div>
        <div className="side-footer"><Radio size={14} /> локальный режим · API</div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">ОБЗОР РЕЙСА</p><h1>{selectedFile?.name ?? "Нет выбранного потока"}</h1></div><button className="icon-button" title="Обновить" onClick={() => void loadFiles()}><RefreshCw size={17} className={loading ? "spin" : ""} /></button></header>
        {error && <div className="notice"><AlertTriangle size={17} /> {error}. Запустите `uvicorn backend.app.main:app --reload`.</div>}
        <div className="metric-row">
          <div className="metric"><span><Activity size={15} />ЗАПИСИ</span><strong>{selectedFile?.readings_count ?? "—"}</strong></div>
          <div className="metric"><span><AlertTriangle size={15} />СОБЫТИЯ</span><strong>{selectedFile?.events_count ?? "—"}</strong></div>
          <div className="metric"><span><Gauge size={15} />ПАРСИНГ</span><strong>{selectedFile?.status ?? "—"}</strong></div>
          <div className="metric"><span><MapPin size={15} />КАРТА</span><strong className="muted">нет координат</strong></div>
        </div>
        <div className="content-grid">
          <section className="panel event-panel"><div className="panel-head"><div><p className="eyebrow">СОБЫТИЯ</p><h2>Сигналы телеметрии</h2></div><div className="event-tools"><div className="search"><Search size={15} /><input placeholder="Поиск" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">Все уровни</option><option value="critical">Critical</option><option value="warning">Warning</option><option value="info">Info</option></select></div></div>
            <div className="event-list">{visibleEvents.map((event, index) => <button className={`event-row ${selectedEvent === event ? "selected" : ""}`} key={`${event.type}-${index}`} onClick={() => setSelectedEvent(event)}><span className={`severity ${event.severity}`} /><span className="event-time">{formatTime(event.ts_start)}</span><span className="event-details"><strong>{event.type}</strong><small>{event.explanation}</small></span><span className="arrow">↗</span></button>)}{visibleEvents.length === 0 && <div className="empty-state"><Activity size={28} /><strong>Событий пока нет</strong><span>Выберите обработанный файл или измените фильтр.</span></div>}</div>
          </section>
          <section className="panel detail-panel"><div className="panel-head"><div><p className="eyebrow">КАРТОЧКА</p><h2>Что произошло</h2></div><span className="detail-index">{selectedEvent ? formatTime(selectedEvent.ts_start) : "—"}</span></div>{selectedEvent ? <div className="detail-content"><span className={`tag ${selectedEvent.severity}`}>{selectedEvent.severity}</span><h3>{selectedEvent.type}</h3><p>{selectedEvent.explanation}</p><dl>{Object.entries(selectedEvent.payload_json).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>{selectedFile && <MapReplay fileId={selectedFile.id} event={selectedEvent} />}</div> : <div className="empty-state detail-empty"><AlertTriangle size={28} /><strong>Выберите событие</strong><span>Здесь появится объяснение и поля, которые его вызвали.</span></div>}</section>
        </div>
        <section className="panel timeline-panel"><div className="panel-head"><div><p className="eyebrow">ХРОНОЛОГИЯ</p><h2>Сутки движения</h2></div><span className="timeline-date">{events[0] ? new Date(events[0].ts_start).toLocaleDateString("ru-RU") : "нет временных данных"}</span></div><div className="timeline"><div className="timeline-line" />{visibleEvents.map((event, index) => <button key={`marker-${index}`} className={`marker ${event.severity}`} style={{ left: `${Math.min(96, 4 + (index / Math.max(1, visibleEvents.length - 1)) * 92)}%` }} title={event.type} onClick={() => setSelectedEvent(event)} />)}</div><div className="ticks"><span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>24:00</span></div></section>
      </section>
    </main>
  );
}

export default App;

createRoot(document.getElementById("root")!).render(<App />);