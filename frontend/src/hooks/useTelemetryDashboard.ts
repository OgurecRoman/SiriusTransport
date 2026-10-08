import { useState, useEffect, useMemo } from "react";

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

type SeverityCounts = { info: number; warning: number; critical: number };
type ProjectSummary = { id: string; name: string; file_ids: string[]; created_at: string };
type ProjectStats = { project_id: string; files_count: number; readings_count: number; events_count: number; severity_counts: SeverityCounts; days: string[] };
type User = { id: string; email: string; name: string };

const API = import.meta.env.VITE_API_URL ?? "/api";

export function useTelemetryDashboard() {
  const [files, setFiles] = useState<FileSummary[]>([]);
  const [selectedFile, setSelectedFile] = useState<FileSummary | null>(null);
  const [events, setEvents] = useState<TelemetryEvent[]>([]);
  const [selectedEvent, setSelectedEvent] = useState<TelemetryEvent | null>(null);
  const [selectedDay, setSelectedDay] = useState("");
  const [severityCounts, setSeverityCounts] = useState<SeverityCounts>({ info: 0, warning: 0, critical: 0 });
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProject, setSelectedProject] = useState<ProjectSummary | null>(null);
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

  const loadProjects = async () => {
    const response = await fetch(`${API}/projects`);
    if (response.ok) {
      const nextProjects = (await response.json()) as ProjectSummary[];
      setProjects(nextProjects);
      if (!selectedProject && nextProjects.length > 0) setSelectedProject(nextProjects[0]);
    }
  };

  useEffect(() => {
    void loadFiles();
    void loadProjects();
    const token = localStorage.getItem("tram_token");
    if (token) {
      void fetch(`${API}/auth/me`, { headers: { Authorization: `Bearer ${token}` } }).then(async (response) => {
        if (response.ok) setUser((await response.json()) as User);
        else localStorage.removeItem("tram_token");
      });
    }
  }, []);

  useEffect(() => {
    setSelectedDay("");
    setSelectedEvent(null);
  }, [selectedFile, selectedProject]);

  useEffect(() => {
    if (!selectedFile && !selectedProject) return;
    const loadEvents = async () => {
      const query = selectedDay ? `?day=${encodeURIComponent(selectedDay)}` : "";
      const eventsUrl = selectedProject
        ? `${API}/projects/${selectedProject.id}/events${query}`
        : `${API}/files/${selectedFile?.id}/events${query}`;
      const countsUrl = selectedProject
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
  }, [selectedFile, selectedProject, selectedDay]);

  const filteredEvents = useMemo(() => events.filter((event) => {
    const matchesSeverity = severity === "all" || event.severity === severity;
    const haystack = `${event.type} ${event.explanation}`.toLowerCase();
    return matchesSeverity && haystack.includes(search.toLowerCase());
  }), [events, search, severity]);

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

  return {
    files, setFiles,
    selectedFile, setSelectedFile,
    events, setEvents,
    selectedEvent, setSelectedEvent,
    selectedDay, setSelectedDay,
    severityCounts, setSeverityCounts,
    projects, setProjects,
    selectedProject, setSelectedProject,
    projectStats, setProjectStats,
    projectFormOpen, setProjectFormOpen,
    projectName, setProjectName,
    user, setUser,
    authOpen, setAuthOpen,
    authMode, setAuthMode,
    authEmail, setAuthEmail,
    authPassword, setAuthPassword,
    authName, setAuthName,
    severity, setSeverity,
    search, setSearch,
    loading, setLoading,
    error, setError,
    filteredEvents,
    loadFiles,
    upload,
    createProject,
    addFileToProject,
    submitAuth,
    logout,
  };
}
