import { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { Activity, AlertTriangle, ArrowUpRight, FileUp, FolderPlus, LogIn, LogOut, MapPin, Radio, RefreshCw, Search, UserPlus } from "lucide-react";
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
  format: "csv" | "jsonseq";
  days: string[];
};

type TelemetryEvent = {
  type: string;
  file_id?: string;
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

type ProjectSummary = { id: string; name: string; file_ids: string[]; created_at: string };
type ProjectStats = { project_id: string; files_count: number; readings_count: number; events_count: number; severity_counts: SeverityCounts; days: string[] };
type SeverityCounts = { info: number; warning: number; critical: number };
type User = { id: string; email: string; name: string };

const API = import.meta.env.VITE_API_URL ?? "/api";
const EVENT_PAGE_SIZE = 200;

const ADAS_VISUALS: Record<string, string> = {
  "brake.crash.activated": "/assets/adas/emergency_brake.gif",
  "adas.traffic_light.activated": "/assets/adas/traffic_light.gif",
  "adas.danger_object.activated": "/assets/adas/danger_object.gif",
};

function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatTimelineTick(timestamp: string, showDate: boolean): string {
  const date = new Date(timestamp);
  return date.toLocaleString("ru-RU", showDate
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" });
}

const EVENT_LABELS: Record<string, string> = {
  "brake.emergency.activated": "Экстренное торможение",
  "brake.crash.activated": "Аварийное торможение",
  "brake.mechanical.activated": "Механическое торможение",
  "brake.rail.activated": "Рельсовое торможение",
  "adas.danger_object.activated": "ADAS: опасный объект",
  "adas.traffic_light.activated": "ADAS: светофор",
  "adas.speed_limit.activated": "ADAS: ограничение скорости",
  "localization.lost": "Потеря локализации",
  "localization.restored": "Локализация восстановлена",
  "warning.level.raised": "Повышен уровень предупреждения",
  "fsm.state.changed": "Изменение режима движения",
  "route.changed": "Изменение маршрута",
  "telemetry.gap": "Разрыв телеметрии",
};

function eventLabel(type: string): string {
  if (EVENT_LABELS[type]) return EVENT_LABELS[type];
  if (type.startsWith("service.") && type.endsWith(".down")) return `Сервис отключён: ${type.split(".")[1]}`;
  if (type.startsWith("service.") && type.endsWith(".up")) return `Сервис восстановлен: ${type.split(".")[1]}`;
  return type;
}

function severityLabel(severity: TelemetryEvent["severity"]): string {
  return { info: "Информация", warning: "Предупреждение", critical: "Критично" }[severity];
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
    if (!mapElement.current) return;
    if (points.length === 0) {
      map.current?.remove();
      map.current = null;
      marker.current = null;
      return;
    }
    if (!map.current) {
      map.current = L.map(mapElement.current, { zoomControl: false }).setView([points[0].latitude, points[0].longitude], 15);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current);
    }
    const resizeFrame = window.requestAnimationFrame(() => map.current?.invalidateSize());
    const line = L.polyline(points.map((point): [number, number] => [point.latitude, point.longitude]), { color: "#d9f99d", weight: 4, opacity: 0.85 }).addTo(map.current);
    map.current.fitBounds(line.getBounds(), { padding: [22, 22] });
    marker.current = L.circleMarker([points[0].latitude, points[0].longitude], { radius: 8, color: "#101517", weight: 3, fillColor: "#ff836d", fillOpacity: 1 }).addTo(map.current);
    return () => { window.cancelAnimationFrame(resizeFrame); line.remove(); marker.current?.remove(); marker.current = null; };
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
  const [selectedDay, setSelectedDay] = useState("");
  const [severityCounts, setSeverityCounts] = useState<SeverityCounts>({ info: 0, warning: 0, critical: 0 });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
  const [viewMode, setViewMode] = useState<"project" | "file">("project");
  const [projectStats, setProjectStats] = useState<ProjectStats | null>(null);
  const [projectFormOpen, setProjectFormOpen] = useState(false);
  const [projectName, setProjectName] = useState("");
  const [user, setUser] = useState<User | null>(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authName, setAuthName] = useState("");
  const [severity, setSeverity] = useState("all");
  const [showInfo, setShowInfo] = useState(false);
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

  const loadProjects = async () => {
    const response = await fetch(`${API}/projects`);
    if (response.ok) {
      const nextProjects = (await response.json()) as ProjectSummary[];
      setProjects(nextProjects);
      if (!selectedProject && nextProjects.length > 0) setSelectedProject(nextProjects[0]);
    }
  };

  useEffect(() => { void loadProjects(); }, []);

  useEffect(() => {
    const token = localStorage.getItem("tram_token");
    if (!token) return;
    void fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
      if (response.ok) setUser((await response.json()) as User);
      else localStorage.removeItem("tram_token");
    });
  }, []);

  useEffect(() => {
    setSelectedDay("");
    setSelectedEvent(null);
  }, [selectedFile, selectedProject]);

  useEffect(() => {
    if (!selectedFile && !selectedProject) return;
    const loadEvents = async () => {
      const query = selectedDay ? `?day=${encodeURIComponent(selectedDay)}` : "";
      const isProjectView = viewMode === "project" && selectedProject;
      const eventsUrl = isProjectView
        ? `${API}/projects/${selectedProject.id}/events${query}`
        : `${API}/files/${selectedFile?.id}/events${query}`;
      const countsUrl = isProjectView
        ? `${API}/projects/${selectedProject.id}/stats${query}`
        : `${API}/files/${selectedFile?.id}/severity-counts${query}`;
      try {
        const [eventsResponse, countsResponse] = await Promise.all([
          fetch(eventsUrl),
          fetch(countsUrl),
        ]);
        if (!eventsResponse.ok || !countsResponse.ok) throw new Error("Не удалось загрузить события");
        setEvents((await eventsResponse.json()) as TelemetryEvent[]);
        const countsPayload = await countsResponse.json() as SeverityCounts | ProjectStats;
        if ("severity_counts" in countsPayload) {
          setProjectStats(countsPayload);
          setSeverityCounts(countsPayload.severity_counts);
        } else {
          setSeverityCounts(countsPayload);
        }
        setError(null);
      } catch (reason) {
        setError(reason instanceof Error ? reason.message : "Не удалось загрузить события");
      }
    };
    void loadEvents();
  }, [selectedFile, selectedProject, selectedDay, viewMode]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesSeverity = severity === "all" || event.severity === severity;
    const matchesInfoVisibility = severity === "info" || event.severity !== "info" || showInfo;
    const haystack = `${event.type} ${event.explanation}`.toLowerCase();
    return matchesSeverity && matchesInfoVisibility && haystack.includes(search.toLowerCase());
  }), [events, search, severity, showInfo]);
  const [eventLimit, setEventLimit] = useState(EVENT_PAGE_SIZE);
  const visibleEvents = filteredEvents.slice(0, eventLimit);
  const timelineEvents = filteredEvents;
  const timelineStart = timelineEvents[0] ? new Date(timelineEvents[0].ts_start).getTime() : 0;
  const timelineEnd = timelineEvents[timelineEvents.length - 1] ? new Date(timelineEvents[timelineEvents.length - 1].ts_start).getTime() : 0;
  const timelineDuration = Math.max(0, timelineEnd - timelineStart);
  const timelineShowDate = timelineDuration >= 24 * 60 * 60 * 1000;
  const timelineTicks = Array.from({ length: 5 }, (_, index) => {
    const timestamp = timelineStart + (timelineDuration * index) / 4;
    return timelineStart ? new Date(timestamp).toISOString() : "";
  });

  const upload = async (file: File) => {
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`${API}/files`, { method: "POST", body: form });
      if (!response.ok) throw new Error(`Загрузка не удалась (HTTP ${response.status})`);
      const uploaded = await response.json() as FileSummary;
      await loadFiles();
      for (let attempt = 0; attempt < 600; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1000));
        const statusResponse = await fetch(`${API}/files/${uploaded.id}`);
        if (!statusResponse.ok) break;
        const current = await statusResponse.json() as FileSummary;
        setFiles((previous) => previous.map((item) => item.id === current.id ? current : item));
        if (current.status === "ready" || current.status === "failed") {
          await loadFiles();
          if (current.status === "failed") throw new Error("Файл загружен, но не прошёл разбор");
          break;
        }
      }
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Не удалось загрузить файл");
    }
  };

  const createProject = async () => {
    if (!projectName.trim()) return;
    const response = await fetch(`${API}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName.trim() }) });
    if (response.ok) { setProjectName(""); setProjectFormOpen(false); await loadProjects(); }
  };

  const addFileToProject = async () => {
    if (!selectedProject || !selectedFile) return;
    const response = await fetch(`${API}/projects/${selectedProject.id}/files/${selectedFile.id}`, { method: "POST" });
    if (!response.ok) {
      setError("Не удалось добавить рейс в проект");
      return;
    }
    const updatedProject = await response.json() as ProjectSummary;
    setSelectedProject(updatedProject);
    await loadProjects();
  };

  const submitAuth = async () => {
    const endpoint = authMode === "login" ? "login" : "register";
    const response = await fetch(`${API}/auth/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: authEmail, password: authPassword, name: authName }) });
    if (!response.ok) { setError(authMode === "login" ? "Не удалось войти" : "Не удалось создать аккаунт"); return; }
    const payload = await response.json() as { token?: string; user: User };
    if (payload.token) localStorage.setItem("tram_token", payload.token);
    setUser(payload.user);
    setAuthOpen(false);
    setAuthPassword("");
  };

  const logout = () => { localStorage.removeItem("tram_token"); setUser(null); };
  const isProjectView = viewMode === "project" && selectedProject !== null;
  const availableDays = isProjectView ? (projectStats?.days ?? []) : (selectedFile?.days ?? []);
  const overviewName = isProjectView ? selectedProject.name : selectedFile?.name ?? "Выберите рейс";
  const overviewReadings = isProjectView ? projectStats?.readings_count ?? "—" : selectedFile?.readings_count ?? "—";
  const overviewEvents = isProjectView ? projectStats?.events_count ?? "—" : selectedFile?.events_count ?? "—";

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><span>Трам WAY</span></div>
        <div className="side-heading"><span>Сохраненные рейсы</span><span className="count">{files.length}</span></div>
        <div className="project-switcher"><label>Проект или отдельный рейс</label><div className="project-row"><select value={isProjectView ? selectedProject?.id ?? "" : ""} onChange={(event) => { const project = projects.find((item) => item.id === event.target.value) ?? null; setSelectedProject(project); setViewMode(project ? "project" : "file"); }}><option value="">Отдельный рейс</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select><button title="Создать проект" onClick={() => setProjectFormOpen((value) => !value)}><FolderPlus size={15} /></button></div>{projectFormOpen && <div className="project-form"><input maxLength={40} placeholder="Название проекта (до 40 символов)" value={projectName} onChange={(event) => setProjectName(event.target.value)} /><button onClick={() => void createProject()}>Создать</button></div>}{isProjectView && <button className="attach-button" onClick={() => void addFileToProject()}>Добавить выбранный рейс</button>}</div>
        <div className="file-list">
          {files.filter((file) => !isProjectView || selectedProject.file_ids.includes(file.id)).map((file) => <button className={`file-item ${viewMode === "file" && selectedFile?.id === file.id ? "active" : ""}`} key={file.id} onClick={() => { setSelectedFile(file); setViewMode("file"); }}><span className={`status-dot ${file.status}`} /><span className="file-copy"><strong title={file.name}>{file.name}</strong><small>{file.format.toUpperCase()} · {file.events_count} событий</small></span></button>)}
          {files.length === 0 && <div className="empty-side">Загрузите поток, и мы покажем, чем жил этот рейс.</div>}
        </div>
        <label className="upload-button"><FileUp size={16} /> Добавить рейс<input type="file" accept=".jsonseq,.json,.csv" onChange={(event) => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void upload(file); }} /></label>
        <div className="account-box">{user ? <><span><strong>{user.name}</strong><small>{user.email}</small></span><button title="Выйти" onClick={logout}><LogOut size={15} /></button></> : <><button className="account-button" onClick={() => setAuthOpen((value) => !value)}><LogIn size={15} /> Войти</button>{authOpen && <div className="auth-form"><div className="auth-tabs"><button className={authMode === "login" ? "active" : ""} onClick={() => setAuthMode("login")}><LogIn size={13} />Вход</button><button className={authMode === "register" ? "active" : ""} onClick={() => setAuthMode("register")}><UserPlus size={13} />Регистрация</button></div>{authMode === "register" && <input placeholder="Имя" value={authName} onChange={(event) => setAuthName(event.target.value)} />}<input placeholder="Email" type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} /><input placeholder="Пароль" type="password" value={authPassword} onChange={(event) => setAuthPassword(event.target.value)} /><button className="auth-submit" onClick={() => void submitAuth()}>{authMode === "login" ? "Войти" : "Создать аккаунт"}</button></div>}</>}</div>
        <div className="side-footer"><Radio size={14} /> локальный режим · API</div>
      </aside>

      <section className="workspace">
        <header className="topbar"><div><p className="eyebrow">{isProjectView ? "Общая папка / обзор проекта" : "Обзор рейса"}</p><h1 title={overviewName}>{overviewName}</h1></div><button className="icon-button" title="Обновить" onClick={() => void loadFiles()}><RefreshCw size={17} className={loading ? "spin" : ""} /></button></header>
        {error && <div className="notice"><AlertTriangle size={17} /> {error}. Запустите `uvicorn backend.app.main:app --reload`.</div>}
        <div className="metric-row">
          <div className="metric"><span>Сигналы</span><strong>{overviewReadings}</strong></div>
          <div className="metric"><span>Все моменты</span><strong>{overviewEvents}</strong></div>
          <div className="metric warning-metric"><span>Предупреждения</span><strong>{severityCounts.warning}</strong></div>
          <div className="metric critical-metric"><span>Критичные</span><strong>{severityCounts.critical}</strong></div>
          <div className="metric"><span>Файлов</span><strong>{isProjectView ? projectStats?.files_count ?? 0 : selectedFile ? 1 : 0}</strong></div>
        </div>
        <div className="content-grid">
          <section className="panel event-panel"><div className="panel-head"><div><p className="eyebrow">События за {selectedDay ? formatDay(selectedDay) : "все дни"}</p><h2>Что происходило в пути</h2></div><div className="event-tools"><select aria-label="День телеметрии" value={selectedDay} onChange={(event) => setSelectedDay(event.target.value)}><option value="">Все дни</option>{availableDays.map((day) => <option value={day} key={day}>{formatDay(day)}</option>)}</select><div className="search"><Search size={15} /><input placeholder="Найти момент" value={search} onChange={(event) => setSearch(event.target.value)} /></div><select value={severity} onChange={(event) => setSeverity(event.target.value)}><option value="all">Все уровни</option><option value="critical">Критично</option><option value="warning">Предупреждения</option><option value="info">Информация</option></select><label className="info-toggle"><input type="checkbox" checked={showInfo} onChange={(event) => setShowInfo(event.target.checked)} />Показать информационные события</label></div></div>
            <div className="event-list">{visibleEvents.map((event, index) => <button className={`event-row ${selectedEvent === event ? "selected" : ""}`} key={`${event.type}-${index}`} onClick={() => setSelectedEvent(event)}><span className={`severity ${event.severity}`} /><span className="event-time">{formatTime(event.ts_start)}</span><span className="event-details"><strong>{eventLabel(event.type)}</strong><small>{event.explanation}</small></span><ArrowUpRight size={15} className="arrow" aria-hidden="true" /></button>)}{visibleEvents.length === 0 && <div className="empty-state"><Activity size={28} /><strong>Событий пока нет</strong><span>Выберите обработанный файл или измените фильтр.</span></div>}{visibleEvents.length < filteredEvents.length && <button className="load-more" onClick={() => setEventLimit((limit) => limit + EVENT_PAGE_SIZE)}>Показать ещё ({filteredEvents.length - visibleEvents.length})</button>}</div>
          </section>
          <section className="panel detail-panel"><div className="panel-head"><div><p className="eyebrow">РАЗБОР МОМЕНТА</p><h2>Почему это важно</h2></div>
          <span className="detail-index">{selectedEvent ? formatTime(selectedEvent.ts_start) : "—"}</span></div>
            {selectedEvent ? <div className="detail-content"><span className={`tag ${selectedEvent.severity}`}>{severityLabel(selectedEvent.severity)}</span>
            <h3>{eventLabel(selectedEvent.type)}</h3>
            <p>{selectedEvent.explanation}</p>
            <dl>{Object.entries(selectedEvent.payload_json).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{String(value)}</dd></div>)}</dl>
            {ADAS_VISUALS[selectedEvent.type] && <div className="visual-wrap">
              <img src={ADAS_VISUALS[selectedEvent.type]} alt={eventLabel(selectedEvent.type)} className="adas-gif" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} /></div>}
              {(selectedEvent.file_id ?? selectedFile?.id) && <MapReplay fileId={selectedEvent.file_id ?? selectedFile?.id ?? ""} event={selectedEvent} />
            }</div> : <div className="empty-state detail-empty"><AlertTriangle size={28} />
            
            <strong>Выберите момент</strong><span>Здесь появится его история, причина и движение вокруг него.</span></div>}</section></div>
        <section className="panel timeline-panel"><div className="panel-head"><div><p className="eyebrow">СЛЕД ДНЯ</p><h2>Линия рейса</h2></div><span className="timeline-date">{timelineEvents[0] ? formatTimelineTick(timelineEvents[0].ts_start, timelineShowDate) : "нет временных данных"}</span></div><div className="timeline"><div className="timeline-line" />{timelineEvents.map((event, index) => { const eventTime = new Date(event.ts_start).getTime(); const position = timelineDuration ? ((eventTime - timelineStart) / timelineDuration) * 100 : 50; return <button key={`marker-${event.type}-${index}`} className={`marker ${event.severity}`} style={{ left: `${Math.min(100, Math.max(0, position))}%` }} title={`${formatTime(event.ts_start)} · ${eventLabel(event.type)}`} onClick={() => setSelectedEvent(event)} />; })}</div><div className="ticks">{timelineTicks.map((tick, index) => <span key={index}>{tick ? formatTimelineTick(tick, timelineShowDate) : "—"}</span>)}</div></section>
      </section>
    </main>
  );
}

export default App;

const rootElement = document.getElementById("root");
if (rootElement && rootElement.dataset.reactMounted !== "true") {
  rootElement.dataset.reactMounted = "true";
  createRoot(rootElement).render(<App />);
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}