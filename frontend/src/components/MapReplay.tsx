import { useEffect, useRef, useState } from "react";
import L from "leaflet";
import { MapPin } from "lucide-react";

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

const API = import.meta.env.VITE_API_URL ?? "/api";

export function MapReplay({ fileId, event }: { fileId: string; event: TelemetryEvent }) {
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

  // Using a helper to avoid needing useMemo in a small component for now,
  // but the logic remains identical to the original.
  const memoPoints = points;

  useEffect(() => {
    if (!mapElement.current) return;
    if (memoPoints.length === 0) {
      map.current?.remove();
      map.current = null;
      marker.current = null;
      return;
    }
    if (!map.current) {
      map.current = L.map(mapElement.current, { zoomControl: false }).setView([memoPoints[0].latitude, memoPoints[0].longitude], 15);
      L.control.zoom({ position: "bottomright" }).addTo(map.current);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", { attribution: "© OpenStreetMap" }).addTo(map.current);
    }
    const resizeFrame = window.requestAnimationFrame(() => map.current?.invalidateSize());
    const line = L.polyline(memoPoints.map((point): [number, number] => [point.latitude, point.longitude]), { color: "#4f46e5", weight: 4, opacity: 0.85 }).addTo(map.current);
    map.current.fitBounds(line.getBounds(), { padding: [22, 22] });
    marker.current = L.circleMarker([memoPoints[0].latitude, memoPoints[0].longitude], { radius: 8, color: "#1e293b", weight: 3, fillColor: "#f43f5e", fillOpacity: 1 }).addTo(map.current);
    return () => { window.cancelAnimationFrame(resizeFrame); line.remove(); marker.current?.remove(); marker.current = null; };
  }, [memoPoints]);

  useEffect(() => {
    if (!playing || memoPoints.length < 2) return;
    const timer = window.setInterval(() => {
      setCursor((current) => {
        if (current >= memoPoints.length - 1) { setPlaying(false); return current; }
        return current + 1;
      });
    }, 400);
    return () => window.clearInterval(timer);
  }, [playing, memoPoints.length]);

  useEffect(() => {
    const point = memoPoints[cursor];
    if (point && marker.current && map.current) {
      marker.current.setLatLng([point.latitude, point.longitude]);
      map.current.panTo([point.latitude, point.longitude], { animate: true, duration: 0.35 });
    }
  }, [cursor, memoPoints]);

  return (
    <div className="relative h-56 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-100 mt-6">
      <div className="h-full w-full" ref={mapElement} />
      {memoPoints.length === 0 ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-slate-500 bg-slate-100/80 text-center p-4">
          <MapPin size={20} />
          <span className="text-xs">Нет валидных координат для этого события</span>
        </div>
      ) : (
        <div className="absolute bottom-3 left-3 right-3 z-[1000] flex items-center gap-2 p-2 bg-white/90 backdrop-blur border border-slate-200 rounded-lg text-[10px] shadow-sm">
          <button
            onClick={() => setPlaying((v) => !v)}
            className="px-2 py-1 bg-indigo-600 text-white rounded hover:bg-indigo-700 transition-colors"
          >
            {playing ? "Пауза" : "Воспроизвести"}
          </button>
          <button
            onClick={() => { setPlaying(false); setCursor(0); }}
            className="px-2 py-1 bg-slate-100 text-slate-700 rounded hover:bg-slate-200 transition-colors"
          >
            Сбросить
          </button>
          <span className="ml-auto font-medium text-slate-600">
            {memoPoints[cursor]?.speed !== undefined ? `${Number(memoPoints[cursor].speed).toFixed(1)} км/ч` : "скорость не указана"}
          </span>
        </div>
      )}
    </div>
  );
}
