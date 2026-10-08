import React, { useMemo } from "react";
import { createRoot } from "react-dom/client";
import {
  Activity, AlertTriangle, ArrowUpRight, FileUp, FolderPlus,
  LogIn, LogOut, MapPin, Radio, RefreshCw, Search, UserPlus,
  ChevronRight, LayoutDashboard, FileText, Settings, Bell
} from "lucide-react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import "./styles.css";
import { useTelemetryDashboard } from "./hooks/useTelemetryDashboard";
import { MapReplay } from "./components/MapReplay";

// --- Utils ---
function formatTime(timestamp: string): string {
  return new Date(timestamp).toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatDay(day: string): string {
  return new Date(`${day}T12:00:00`).toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
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

function severityLabel(severity: string): string {
  return { info: "Информация", warning: "Предупреждение", critical: "Критично" }[severity] || severity;
}

// --- Components ---

function MetricCard({ label, value, variant = "default" }: { label: string; value: string | number; variant?: "default" | "warning" | "critical" }) {
  const variantColors = {
    default: "text-slate-900",
    warning: "text-amber-600",
    critical: "text-rose-600",
  };
  return (
    <div className="p-4 bg-white rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between min-h-[88px] transition-all duration-200 hover:shadow-md">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">{label}</span>
      <strong className={`text-2xl font-bold ${variantColors[variant]}`}>{value}</strong>
    </div>
  );
}

function EventRow({ event, isSelected, onClick }: { event: any; isSelected: boolean; onClick: () => void }) {
  const severityColor = {
    info: "bg-indigo-500",
    warning: "bg-amber-500",
    critical: "bg-rose-500",
  }[event.severity] || "bg-slate-400";

  return (
    <button
      onClick={onClick}
      className={`w-full grid grid-cols-[8px_80px_1fr_24px] items-center gap-4 p-4 text-left transition-all duration-200 border-b border-slate-50 ${isSelected ? "bg-indigo-50/50 ring-1 ring-inset ring-indigo-100" : "hover:bg-slate-50"}`}
    >
      <span className={`h-2 w-2 rounded-full shrink-0 ${severityColor}`} />
      <span className="text-xs font-medium text-slate-500">{formatTime(event.ts_start)}</span>
      <div className="min-w-0 flex flex-col">
        <strong className="text-sm font-semibold text-slate-800 truncate">{eventLabel(event.type)}</strong>
        <small className="text-xs text-slate-500 truncate">{event.explanation}</small>
      </div>
      <ArrowUpRight size={16} className={`text-slate-300 ${isSelected ? "text-indigo-400" : ""}`} />
    </button>
  );
}

function App() {
  const state = useTelemetryDashboard();
  const {
    files, selectedFile, setSelectedFile,
    events, selectedEvent, setSelectedEvent,
    selectedDay, setSelectedDay,
    severityCounts, projects, selectedProject, setSelectedProject,
    projectStats, projectFormOpen, setProjectFormOpen,
    projectName, setProjectName,
    user, authOpen, setAuthOpen, authMode, setAuthMode,
    authEmail, setAuthEmail, authPassword, setAuthPassword,
    authName, setAuthName,
    severity, setSeverity,
    search, setSearch,
    loading, error, filteredEvents,
    loadFiles, upload, createProject, addFileToProject,
    submitAuth, logout
  } = state;

  const EVENT_PAGE_SIZE = 200;
  const visibleEvents = filteredEvents.slice(0, EVENT_PAGE_SIZE);

  const overviewName = selectedProject?.name ?? selectedFile?.name ?? "Выберите рейс";
  const overviewReadings = projectStats?.readings_count ?? selectedFile?.readings_count ?? "—";
  const overviewEvents = projectStats?.events_count ?? selectedFile?.events_count ?? "—";
  const availableDays = selectedProject ? (projectStats?.days ?? []) : (selectedFile?.days ?? []);

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      {/* Sidebar */}
      <aside className="w-72 flex-shrink-0 bg-white border-r border-slate-200 flex flex-col transition-all duration-300">
        <div className="p-6 flex items-center gap-3">
          <div className="w-8 h-8 bg-indigo-600 rounded-lg flex items-center justify-center text-white shadow-lg shadow-indigo-200">
            <Radio size={18} />
          </div>
          <span className="font-bold text-lg tracking-tight text-slate-800">Трам WAY</span>
        </div>

        <div className="px-6 mb-4 flex justify-between items-center">
          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Сохраненные рейсы</span>
          <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-2 py-0.5 rounded-full">{files.length}</span>
        </div>

        <div className="px-6 space-y-3">
          <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3">
            <label className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Проект</label>
            <div className="flex gap-2">
              <select
                className="flex-1 text-xs p-2 rounded-lg border border-slate-200 bg-white focus:ring-2 focus:ring-indigo-500 outline-none transition-all"
                value={selectedProject?.id ?? ""}
                onChange={(e) => setSelectedProject(projects.find(p => p.id === e.target.value) ?? null)}
              >
                <option value="">Все файлы</option>
                {projects.map(p => <option value={p.id} key={p.id}>{p.name}</option>)}
              </select>
              <button
                onClick={() => setProjectFormOpen(!projectFormOpen)}
                className="p-2 bg-white border border-slate-200 rounded-lg text-slate-600 hover:text-indigo-600 hover:border-indigo-200 transition-all"
                title="Создать проект"
              >
                <FolderPlus size={16} />
              </button>
            </div>
            {projectFormOpen && (
              <div className="space-y-2 pt-2 border-t border-slate-200">
                <input
                  placeholder="Название проекта"
                  className="w-full text-xs p-2 rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                />
                <button
                  onClick={() => void createProject()}
                  className="w-full py-2 bg-indigo-600 text-white text-xs font-semibold rounded-lg hover:bg-indigo-700 transition-colors"
                >
                  Создать
                </button>
              </div>
            )}
            {selectedProject && (
              <button
                onClick={() => void addFileToProject()}
                className="w-full py-2 bg-indigo-50 text-indigo-600 text-xs font-semibold rounded-lg hover:bg-indigo-100 transition-colors border border-indigo-100"
              >
                Добавить выбранный рейс
              </button>
            )}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-3 py-4 space-y-1">
          {files.filter(f => !selectedProject || selectedProject.file_ids.includes(f.id)).map(file => (
            <button
              key={file.id}
              onClick={() => setSelectedFile(file)}
              className={`w-full flex items-center gap-3 p-3 rounded-xl text-left transition-all duration-200 group ${selectedFile?.id === file.id ? "bg-indigo-50 text-indigo-700 shadow-sm ring-1 ring-indigo-100" : "hover:bg-slate-50 text-slate-600"}`}
            >
              <span className={`h-2 w-2 rounded-full shrink-0 ${file.status === 'ready' ? 'bg-emerald-500' : file.status === 'parsing' ? 'bg-amber-500' : 'bg-slate-300'}`} />
              <div className="min-w-0 flex flex-col">
                <span className="text-xs font-semibold truncate">{file.name}</span>
                <span className="text-[10px] opacity-70 truncate">{file.format.toUpperCase()} · {file.events_count} событий</span>
              </div>
            </button>
          ))}
          {files.length === 0 && <div className="p-4 text-center text-xs text-slate-400 italic">Загрузите поток, и мы покажем, чем жил этот рейс.</div>}
        </div>

        <div className="p-6 space-y-4">
          <label className="flex items-center justify-center gap-2 w-full p-3 border-2 border-dashed border-slate-200 rounded-xl text-xs font-bold text-slate-500 hover:border-indigo-300 hover:text-indigo-600 hover:bg-indigo-50/30 cursor-pointer transition-all">
            <FileUp size={16} />
            Добавить рейс
            <input type="file" className="hidden" accept=".jsonseq,.json,.csv" onChange={(e) => { const file = e.target.files?.[0]; e.target.value = ""; if (file) void upload(file); }} />
          </label>

          <div className="pt-4 border-t border-slate-100">
            {user ? (
              <div className="flex items-center justify-between gap-3 p-2 bg-slate-50 rounded-xl">
                <div className="min-w-0">
                  <div className="text-xs font-bold text-slate-800 truncate">{user.name}</div>
                  <div className="text-[10px] text-slate-500 truncate">{user.email}</div>
                </div>
                <button onClick={logout} className="p-2 text-slate-400 hover:text-rose-500 transition-colors rounded-lg hover:bg-rose-50">
                  <LogOut size={16} />
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <button
                  onClick={() => setAuthOpen(!authOpen)}
                  className="w-full flex items-center justify-center gap-2 p-2 bg-white border border-slate-200 rounded-xl text-xs font-semibold text-slate-600 hover:border-indigo-200 hover:text-indigo-600 transition-all"
                >
                  <LogIn size={14} /> Войти
                </button>
                {authOpen && (
                  <div className="p-3 bg-slate-50 rounded-xl border border-slate-100 space-y-3 animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex p-1 bg-slate-200/50 rounded-lg">
                      <button
                        onClick={() => setAuthMode("login")}
                        className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${authMode === "login" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}
                      >
                        Вход
                      </button>
                      <button
                        onClick={() => setAuthMode("register")}
                        className={`flex-1 py-1 text-[10px] font-bold rounded-md transition-all ${authMode === "register" ? "bg-white text-indigo-600 shadow-sm" : "text-slate-500"}`}
                      >
                        Регистрация
                      </button>
                    </div>
                    {authMode === "register" && <input placeholder="Имя" className="w-full p-2 text-xs rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500" value={authName} onChange={(e) => setAuthName(e.target.value)} />}
                    <input placeholder="Email" type="email" className="w-full p-2 text-xs rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500" value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} />
                    <input placeholder="Пароль" type="password" className="w-full p-2 text-xs rounded-lg border border-slate-200 outline-none focus:ring-2 focus:ring-indigo-500" value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} />
                    <button
                      onClick={() => void submitAuth()}
                      className="w-full py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700 transition-colors"
                    >
                      {authMode === "login" ? "Войти" : "Создать аккаунт"}
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center justify-center gap-2 py-3 text-[10px] font-medium text-slate-400">
            <Radio size={12} /> локальный режим · API
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="h-16 bg-white border-b border-slate-200 px-8 flex items-center justify-between shrink-0">
          <div className="flex flex-col">
            <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">{selectedProject ? "Общая папка / обзор проекта" : "Обзор рейса"}</p>
            <h1 className="text-xl font-bold text-slate-800 leading-tight">{overviewName}</h1>
          </div>
          <button
            onClick={() => void loadFiles()}
            className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition-all border border-transparent hover:border-indigo-100"
            title="Обновить данные"
          >
            <RefreshCw size={20} className={loading ? "animate-spin" : ""} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto p-8 space-y-6">
          {error && (
            <div className="flex items-center gap-3 p-4 bg-rose-50 border border-rose-100 text-rose-600 rounded-xl text-xs font-medium animate-in fade-in slide-in-from-top-2">
              <AlertTriangle size={18} className="shrink-0" />
              <span>{error}. Запустите `uvicorn backend.app.main:app --reload`.</span>
            </div>
          )}

          {/* Metrics */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            <MetricCard label="Сигналы" value={overviewReadings} />
            <MetricCard label="Все моменты" value={overviewEvents} />
            <MetricCard label="Предупреждения" value={severityCounts.warning} variant="warning" />
            <MetricCard label="Критичные" value={severityCounts.critical} variant="critical" />
            <MetricCard label="Файлов" value={projectStats?.files_count ?? (selectedFile ? 1 : 0)} />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Event Panel */}
            <section className="lg:col-span-7 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">События за {selectedDay ? formatDay(selectedDay) : "все дни"}</p>
                  <h2 className="text-lg font-bold text-slate-800">Что происходило в пути</h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  <select
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={selectedDay}
                    onChange={(e) => setSelectedDay(e.target.value)}
                  >
                    <option value="">Все дни</option>
                    {availableDays.map(day => <option value={day} key={day}>{formatDay(day)}</option>)}
                  </select>
                  <div className="relative">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      placeholder="Найти момент"
                      className="pl-8 pr-3 py-2 text-xs rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500 w-40"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>
                  <select
                    className="text-xs p-2 rounded-lg border border-slate-200 bg-slate-50 outline-none focus:ring-2 focus:ring-indigo-500"
                    value={severity}
                    onChange={(e) => setSeverity(e.target.value)}
                  >
                    <option value="all">Все уровни</option>
                    <option value="critical">Критично</option>
                    <option value="warning">Предупреждения</option>
                    <option value="info">Информация</option>
                  </select>
                </div>
              </div>
              <div className="flex-1 overflow-y-auto max-h-[500px]">
                {visibleEvents.map((event, index) => (
                  <EventRow
                    key={`${event.type}-${index}`}
                    event={event}
                    isSelected={selectedEvent === event}
                    onClick={() => setSelectedEvent(event)}
                  />
                ))}
                {visibleEvents.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-20 text-center space-y-2 text-slate-400">
                    <Activity size={32} className="opacity-20" />
                    <strong className="text-sm font-semibold text-slate-500">Событий пока нет</strong>
                    <span className="text-xs max-w-xs mx-auto">Выберите обработанный файл или измените фильтр.</span>
                  </div>
                )}
                {visibleEvents.length < filteredEvents.length && (
                  <button
                    onClick={() => setEventLimit((l) => l + EVENT_PAGE_SIZE)}
                    className="w-full p-4 text-xs font-bold text-indigo-600 bg-indigo-50/50 hover:bg-indigo-50 transition-colors border-t border-slate-100"
                  >
                    Показать ещё ({filteredEvents.length - visibleEvents.length})
                  </button>
                )}
              </div>
            </section>

            {/* Detail Panel */}
            <section className="lg:col-span-5 bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-5 border-b border-slate-100 flex justify-between items-center">
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">РАЗБОР МОМЕНТА</p>
                  <h2 className="text-lg font-bold text-slate-800">Почему это важно</h2>
                </div>
                <span className="text-xs font-medium text-slate-400">{selectedEvent ? formatTime(selectedEvent.ts_start) : "—"}</span>
              </div>
              {selectedEvent ? (
                <div className="p-6 space-y-6 overflow-y-auto">
                  <div className="space-y-3">
                    <span className={`inline-block px-2 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-white ${
                      selectedEvent.severity === 'critical' ? 'bg-rose-500' :
                      selectedEvent.severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
                    }`}>
                      {severityLabel(selectedEvent.severity)}
                    </span>
                    <h3 className="text-xl font-bold text-slate-800 leading-tight">{eventLabel(selectedEvent.type)}</h3>
                    <p className="text-sm text-slate-600 leading-relaxed">{selectedEvent.explanation}</p>
                  </div>

                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Параметры события</p>
                    <dl className="divide-y divide-slate-100 border rounded-xl border-slate-100 overflow-hidden">
                      {Object.entries(selectedEvent.payload_json).map(([key, value]) => (
                        <div key={key} className="flex justify-between p-3 text-xs hover:bg-slate-50 transition-colors">
                          <dt className="text-slate-500 font-medium">{key}</dt>
                          <dd className="text-slate-800 font-mono text-right break-all ml-4">{String(value)}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>

                  {(selectedEvent.file_id ?? selectedFile?.id) && (
                    <MapReplay fileId={selectedEvent.file_id ?? selectedFile?.id ?? ""} event={selectedEvent} />
                  )}
                </div>
              ) : (
                <div className="flex-1 flex flex-col items-center justify-center py-20 text-center space-y-3 text-slate-400 p-8">
                  <div className="p-4 bg-slate-50 rounded-full text-slate-300">
                    <AlertTriangle size={32} />
                  </div>
                  <div>
                    <strong className="block text-sm font-semibold text-slate-500">Выберите момент</strong>
                    <span className="text-xs block max-w-xs mx-auto opacity-70">Здесь появится его история, причина и движение вокруг него.</span>
                  </div>
                </div>
              )}
            </section>
          </div>

          {/* Timeline Panel */}
          <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="p-5 border-b border-slate-100 flex justify-between items-center">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">СЛЕД ДНЯ</p>
                <h2 className="text-lg font-bold text-slate-800">Линия рейса</h2>
              </div>
              <span className="text-xs font-medium text-slate-400">{events[0] ? new Date(events[0].ts_start).toLocaleDateString("ru-RU") : "нет данных"}</span>
            </div>
            <div className="p-8">
              <div className="relative h-12 flex items-center">
                <div className="absolute h-0.5 w-full bg-slate-200 rounded-full" />
                {visibleEvents.map((event, index) => (
                  <button
                    key={`marker-${index}`}
                    onClick={() => setSelectedEvent(event)}
                    className={`absolute h-4 w-4 -translate-y-1/2 rounded-full border-2 border-white shadow-sm transition-all duration-200 hover:scale-150 ${
                      event.severity === 'critical' ? 'bg-rose-500' :
                      event.severity === 'warning' ? 'bg-amber-500' : 'bg-indigo-500'
                    } ${selectedEvent === event ? 'ring-2 ring-indigo-300 ring-offset-2 scale-125' : ''}`}
                    style={{ left: `${Math.min(98, 1 + (index / Math.max(1, visibleEvents.length - 1)) * 97)}%` }}
                    title={eventLabel(event.type)}
                  />
                ))}
              </div>
              <div className="flex justify-between px-1 mt-4 text-[10px] font-bold text-slate-400 uppercase tracking-widest">
                <span>00:00</span>
                <span>06:00</span>
                <span>12:00</span>
                <span>18:00</span>
                <span>24:00</span>
              </div>
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}

const rootElement = document.getElementById("root");
if (rootElement && rootElement.dataset.reactMounted !== "true") {
  rootElement.dataset.reactMounted = "true";
  createRoot(rootElement).render(<App />);
}
