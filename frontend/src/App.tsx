import { useCallback, useEffect, useRef, useState } from "react";
import {
  Activity, AlertTriangle, ArrowDownWideNarrow, ArrowUpWideNarrow, ChevronDown,
  ChevronRight, CircleHelp, Cpu, FilePlus2, GitFork, Gauge, HardDrive,
  LayoutDashboard, ListFilter, LoaderCircle, Menu, Monitor, Pause, Play,
  RefreshCw, Search, Settings2, ShieldAlert, Signal, Square, Terminal,
  Timer, UserRound, X, Zap, Power, ZoomIn, ZoomOut, Maximize2, type LucideIcon,
} from "lucide-react";
import {
  CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

type PageId = "dashboard" | "inspector" | "control" | "creation" | "monitor" | "tree" | "resources" | "priority" | "watchdog" | "lifecycle";
type ProcessInfo = {
  pid: number; ppid: number; name: string; state: string; stateLabel: string;
  cpuPercent: number | null; cpuTimeNs: number; userTimeNs: number; systemTimeNs: number;
  memoryBytes: number; uid: number; user: string; startTimeUnix: number; executablePath?: string;
  command: string; memoryPercent: number | null; threadCount: number | null;
};
type SystemStatus = {
  processCount: number; cpuPercent: number | null; memoryPercent: number | null;
  memoryTotalBytes: number; memoryAvailableBytes: number; backend: string;
  system: string; updatedAt: string;
};
type SystemResourcePoint = {
  time: string; cpu: number | null; memory: number | null; swap: number | null;
  load: number | null; diskRead: number | null; diskWrite: number | null;
  networkReceived: number | null; networkSent: number | null;
};
type SystemResources = {
  processCount: number; cpuPercent: number | null; cpuCores: { name: string; cpuPercent: number | null }[];
  memoryTotalBytes: number; memoryUsedBytes: number; memoryAvailableBytes: number; memoryFreeBytes: number;
  memoryPercent: number | null; swapTotalBytes: number; swapUsedBytes: number; swapFreeBytes: number;
  swapPercent: number | null; diskTotalBytes: number; diskUsedBytes: number; diskAvailableBytes: number;
  diskReadBytesPerSecond: number | null; diskWriteBytesPerSecond: number | null;
  networkReceivedBytesPerSecond: number | null; networkSentBytesPerSecond: number | null;
  loadAverage: number[]; updatedAt: string;
};
type ProcessResourceSample = {
  pid: number; name: string; state: string; cpuPercent: number | null;
  memoryBytes: number; userTimeNs: number; systemTimeNs: number; updatedAt: string;
};
type ProcessTelemetryPoint = {
  time: string; cpu: number | null; memory: number | null;
  userTime: number | null; systemTime: number | null;
};
type SchedulingPolicy = "normal" | "batch" | "idle" | "other";
type SettableSchedulingPolicy = "normal" | "batch";
type LifecycleEvent = { timestamp: string; event: string; pid: number; name: string };
type Watchdog = { id: string; pid: number; threshold: number; duration: number; elapsed: number; running: boolean; status: string; cpuPercent: number | null; memoryBytes: number; updatedAt: string };
type Toast = { id: number; message: string; type: "success" | "error" | "info" };

function lifecycleEventKey(event: LifecycleEvent): string {
  return `${event.timestamp}:${event.event}:${event.pid}:${event.name}`;
}

const API = "/api";
async function request<T>(path: string, options?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, {
      cache: "no-store",
      ...options,
      headers: { "Content-Type": "application/json", ...options?.headers },
    });
  } catch {
    throw new Error("Backend unavailable. Start the Node API in WSL and try again.");
  }
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error ?? `Request failed (${response.status}).`);
  return result as T;
}

const navigation: { id: PageId | "refresh" | "exit"; label: string; icon: LucideIcon; number: string }[] = [
  { id: "dashboard", label: "Process Dashboard", icon: LayoutDashboard, number: "01" },
  { id: "inspector", label: "Process Inspector", icon: Search, number: "02" },
  { id: "control", label: "Process Control", icon: Settings2, number: "03" },
  { id: "creation", label: "Creation & Launch", icon: FilePlus2, number: "04" },
  { id: "monitor", label: "Live Monitoring", icon: Activity, number: "05" },
  { id: "tree", label: "Process Tree", icon: GitFork, number: "06" },
  { id: "resources", label: "Resource Monitor", icon: Gauge, number: "07" },
  { id: "priority", label: "Priority & Scheduling", icon: ArrowUpWideNarrow, number: "08" },
  { id: "watchdog", label: "Watchdog & Alerts", icon: ShieldAlert, number: "09" },
  { id: "lifecycle", label: "Lifecycle / Event Log", icon: Timer, number: "10" },
  { id: "refresh", label: "Refresh Dashboard", icon: RefreshCw, number: "11" },
  { id: "exit", label: "Exit Application", icon: Power, number: "12" },
];

const pageTitles: Record<PageId, string> = {
  dashboard: "Process Dashboard", inspector: "Process Inspector", control: "Process Control",
  creation: "Process Creation & Launch", monitor: "Live Process Monitoring", tree: "Process Tree",
  resources: "Resource Monitor", priority: "Priority & Scheduling", watchdog: "Process Watchdog",
  lifecycle: "Lifecycle / Event Logger",
};

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
  return `${value.toFixed(unit > 1 ? 1 : 0)} ${units[unit]}`;
}

function formatPercent(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? "—" : `${value.toFixed(1)}%`;
}

function timeOf(value: string | number): string {
  return new Date(value).toLocaleTimeString([], { hour12: false });
}

function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "green" | "amber" | "red" | "neutral" }) {
  return <span className={`badge badge-${tone}`}><i />{children}</span>;
}

function Metric({ label, value, detail, icon: Icon, tone = "green" }: { label: string; value: string; detail: string; icon: LucideIcon; tone?: string }) {
  return <article className="metric-panel">
    <div className="metric-top"><span>{label}</span><Icon size={16} /></div>
    <div className="metric-value">{value}</div>
    <div className="metric-detail"><span className={`signal-dot ${tone}`} />{detail}</div>
  </article>;
}

function EmptyState({ icon: Icon = CircleHelp, title, description }: { icon?: LucideIcon; title: string; description: string }) {
  return <div className="empty-state"><Icon size={21} /><strong>{title}</strong><span>{description}</span></div>;
}

function ToastStack({ items }: { items: Toast[] }) {
  return <div className="toast-stack" aria-live="polite">{items.map((toast) =>
    <div className={`toast toast-${toast.type}`} key={toast.id}><i />{toast.message}</div>,
  )}</div>;
}

function ConfirmDialog({ title, detail, confirmLabel, onConfirm, onCancel, danger = true, busy = false }: {
  title: string; detail: string; confirmLabel: string; onConfirm: () => void; onCancel: () => void; danger?: boolean; busy?: boolean;
}) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
    <section className="confirm-modal" role="dialog" aria-modal="true" aria-labelledby="confirm-title">
      <div className="modal-icon"><AlertTriangle size={20} /></div>
      <h2 id="confirm-title">{title}</h2><p>{detail}</p>
      <div className="modal-actions"><button className="button button-quiet" onClick={onCancel}>Cancel</button>
        <button className={`button ${danger ? "button-danger" : "button-primary"}`} onClick={onConfirm} disabled={busy}>
          {busy && <LoaderCircle size={15} className="spin" />}{confirmLabel}
        </button>
      </div>
    </section>
  </div>;
}

function ProcessTable({ processes, onSelect }: { processes: ProcessInfo[]; onSelect: (process: ProcessInfo) => void }) {
  const [query, setQuery] = useState("");
  const [stateFilter, setStateFilter] = useState("all");
  const [sortKey, setSortKey] = useState<"pid" | "name" | "cpuPercent" | "memoryBytes" | "memoryPercent" | "threadCount" | "startTimeUnix">("cpuPercent");
  const [descending, setDescending] = useState(true);
  const [page, setPage] = useState(0);
  const filtered = processes.filter((item) => {
    const matchesText = `${item.pid} ${item.name} ${item.command} ${item.user}`.toLowerCase().includes(query.toLowerCase());
    return matchesText && (stateFilter === "all" || item.stateLabel.toLowerCase() === stateFilter);
  }).sort((left, right) => {
    const first = left[sortKey] ?? -1;
    const second = right[sortKey] ?? -1;
    const order = typeof first === "string" ? first.localeCompare(String(second)) : Number(first) - Number(second);
    return descending ? -order : order;
  });
  const pageSize = 12;
  const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
  useEffect(() => setPage(0), [query, stateFilter]);
  const sort = (key: typeof sortKey) => {
    if (key === sortKey) setDescending(!descending);
    else { setSortKey(key); setDescending(key !== "name"); }
  };
  return <section className="data-panel">
    <div className="table-heading"><div><h2>Process table</h2><span>{filtered.length.toLocaleString()} processes in current view</span></div>
      <div className="table-tools">
        <label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search PID, command, user" /></label>
        <label className="select-box"><ListFilter size={14} /><select value={stateFilter} onChange={(event) => setStateFilter(event.target.value)}>
          <option value="all">All states</option><option value="running">Running</option><option value="sleeping">Sleeping</option><option value="stopped">Stopped</option><option value="zombie">Zombie</option>
        </select></label>
      </div>
    </div>
    <div className="table-scroll"><table>
      <thead><tr>
        <th><button onClick={() => sort("pid")}>PID {sortKey === "pid" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th>
        <th><button onClick={() => sort("name")}>Process {sortKey === "name" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th>
        <th>State</th><th>PPID</th>
        <th><button onClick={() => sort("cpuPercent")}>CPU {sortKey === "cpuPercent" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th>
        <th><button onClick={() => sort("memoryPercent")}>Memory {sortKey === "memoryPercent" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th>
        <th><button onClick={() => sort("threadCount")}>Threads {sortKey === "threadCount" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th>
        <th><button onClick={() => sort("startTimeUnix")}>Started {sortKey === "startTimeUnix" && (descending ? <ArrowDownWideNarrow size={13} /> : <ArrowUpWideNarrow size={13} />)}</button></th><th>User</th>
      </tr></thead>
      <tbody>{filtered.slice(page * pageSize, (page + 1) * pageSize).map((item) => <tr key={item.pid} onClick={() => onSelect(item)} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") onSelect(item); }}>
        <td className="mono pid-cell">{item.pid}</td><td className="process-name"><span className="process-glyph">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small title={item.command}>{item.command}</small></span></td>
        <td><Badge tone={item.stateLabel === "Running" ? "green" : item.stateLabel === "Stopped" ? "amber" : "neutral"}>{item.stateLabel}</Badge></td>
        <td className="mono dim">{item.ppid}</td><td className="mono">{formatPercent(item.cpuPercent)}</td><td className="mono">{formatBytes(item.memoryBytes)}<small className="table-subvalue">{formatPercent(item.memoryPercent)}</small></td>
        <td className="mono">{item.threadCount ?? "—"}</td><td className="mono">{item.startTimeUnix > 0 ? new Date(item.startTimeUnix * 1000).toLocaleString() : "—"}</td><td className="dim"><UserRound size={13} /> {item.user}</td>
      </tr>)}</tbody>
    </table>{filtered.length === 0 && <EmptyState icon={Search} title="No matching processes" description="Try a different search or state filter." />}</div>
    <footer className="table-footer"><span>Showing {filtered.length ? page * pageSize + 1 : 0}–{Math.min((page + 1) * pageSize, filtered.length)} of {filtered.length}</span>
      <div><button className="page-button" disabled={page === 0} onClick={() => setPage(Math.max(0, page - 1))}>Previous</button><span>{page + 1} / {totalPages}</span><button className="page-button" disabled={page + 1 >= totalPages} onClick={() => setPage(Math.min(totalPages - 1, page + 1))}>Next</button></div>
    </footer>
  </section>;
}

function ChartPanel({ title, subtitle, data, dataKey, color, unit = "%" }: { title: string; subtitle: string; data: SystemResourcePoint[]; dataKey: Exclude<keyof SystemResourcePoint, "time">; color: string; unit?: string }) {
  const values = data.map((point) => point[dataKey]).filter((value): value is number => value !== null && Number.isFinite(value));
  return <section className="chart-panel"><div className="chart-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><span className="chart-current" style={{ color }}>{values.length ? `${values.at(-1)!.toFixed(1)}${unit}` : "—"}</span></div>
    <div className="chart-canvas">{values.length === 0 ? <div className="chart-empty">Awaiting live samples</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
      <CartesianGrid stroke="#28302b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#758078", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
      <YAxis tick={{ fill: "#758078", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
      <Tooltip contentStyle={{ background: "#171c18", border: "1px solid #343d36", borderRadius: 6, color: "#e5ebe6", fontSize: 12 }} formatter={(value: number) => [`${value.toFixed(2)}${unit}`, title]} />
      <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
    </LineChart></ResponsiveContainer>}</div>
  </section>;
}

function Dashboard({ processes, status, createdCount, updatedAt, onSelect, onPage }: {
  processes: ProcessInfo[]; status: SystemStatus | null; createdCount: number; updatedAt: string | null;
  onSelect: (process: ProcessInfo) => void; onPage: (page: PageId) => void;
}) {
  const counts = {
    running: processes.filter((item) => item.state === "R").length,
    stopped: processes.filter((item) => item.state === "T" || item.state === "t").length,
    sleeping: processes.filter((item) => item.state === "S" || item.state === "D" || item.state === "I").length,
  };
  return <>
    <div className="page-intro"><div><div className="eyebrow"><span className="pulse-dot" /> LIVE SYSTEM SNAPSHOT</div><h1>Process Dashboard</h1><p>Kernel-backed process inventory and host utilization.</p></div>
      <span className="updated-chip">Updated {updatedAt ? timeOf(updatedAt) : "—"}</span></div>
    <div className="metric-grid">
      <Metric label="Total processes" value={status ? status.processCount.toLocaleString() : "—"} detail="Observed in /proc" icon={Activity} />
      <Metric label="Running" value={counts.running.toLocaleString()} detail="State R" icon={Play} />
      <Metric label="Stopped" value={counts.stopped.toLocaleString()} detail="State T / t" icon={Pause} tone="amber" />
      <Metric label="Sleeping" value={counts.sleeping.toLocaleString()} detail="S / D / I states" icon={Square} tone="neutral" />
      <Metric label="Created here" value={createdCount.toLocaleString()} detail="App-launched and active" icon={Terminal} />
    </div>
    <div className="overview-grid">
      <section className="util-panel"><div className="panel-title"><div><span className="eyebrow">HOST UTILIZATION</span><h2>System load</h2></div><Badge tone="green">Live</Badge></div>
        <div className="util-lines"><div><span><Cpu size={15} /> CPU usage</span><strong>{formatPercent(status?.cpuPercent)}</strong></div><div className="meter"><i style={{ width: `${Math.min(status?.cpuPercent ?? 0, 100)}%` }} /></div>
          <div><span><HardDrive size={15} /> Memory in use</span><strong>{formatPercent(status?.memoryPercent)}</strong></div><div className="meter meter-cyan"><i style={{ width: `${Math.min(status?.memoryPercent ?? 0, 100)}%` }} /></div>
          <div className="memory-caption"><span>{status ? formatBytes(status.memoryTotalBytes - status.memoryAvailableBytes) : "—"} used</span><span>{status ? formatBytes(status.memoryTotalBytes) : "—"} total</span></div>
        </div>
      </section>
      <section className="quick-panel"><div className="panel-title"><div><span className="eyebrow">SYSTEM CONTEXT</span><h2>Runtime status</h2></div><Monitor size={17} /></div>
        <div className="runtime-row"><span>Operating environment</span><strong>{status?.system ?? "Waiting"}</strong></div>
        <div className="runtime-row"><span>Process source</span><strong className="mono">/proc</strong></div>
        <div className="runtime-row"><span>Last refresh</span><strong className="mono">{updatedAt ? timeOf(updatedAt) : "—"}</strong></div>
        <button className="text-action" onClick={() => onPage("resources")}>Open resource monitor <ChevronRight size={15} /></button>
      </section>
    </div>
    <ProcessTable processes={processes} onSelect={onSelect} />
  </>;
}

function ProcessInspector({ processes, selectedPid, setSelectedPid, notify, goTo }: {
  processes: ProcessInfo[]; selectedPid: number | null; setSelectedPid: (pid: number) => void;
  notify: (message: string, type?: Toast["type"]) => void; goTo: (page: PageId) => void;
}) {
  const [input, setInput] = useState(selectedPid ? String(selectedPid) : "");
  const [detail, setDetail] = useState<ProcessInfo | null>(null);
  const [busy, setBusy] = useState(false);
  async function inspect(pid = Number(input)) {
    if (!Number.isInteger(pid) || pid < 1) { notify("Enter a valid PID.", "error"); return; }
    setBusy(true);
    try { const result = await request<ProcessInfo>(`/processes/${pid}`); setDetail(result); setSelectedPid(pid); setInput(String(pid)); }
    catch (error) { setDetail(null); notify((error as Error).message, "error"); }
    finally { setBusy(false); }
  }
  useEffect(() => { if (selectedPid) { setInput(String(selectedPid)); void inspect(selectedPid); } }, [selectedPid]);
  const show = detail ?? processes.find((item) => item.pid === selectedPid) ?? null;
  return <><PageIntro eyebrow="PROCESS DETAILS" title="Process Inspector" description="Inspect executable identity, parentage, state, and current resource counters." />
    <section className="data-panel inspector-search"><form className="pid-form" onSubmit={(event) => { event.preventDefault(); void inspect(); }}><label>Process ID<input inputMode="numeric" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Enter PID" /></label><button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Inspect process</button></form>
      {show ? <><div className="inspector-hero"><div className="large-process-icon">{show.name.slice(0, 1).toUpperCase()}</div><div><span className="eyebrow">PID {show.pid} · PPID {show.ppid}</span><h2>{show.name}</h2><span className="mono path-text">{show.executablePath ?? "Executable path not available"}</span></div><Badge tone={show.stateLabel === "Running" ? "green" : "neutral"}>{show.stateLabel}</Badge></div>
        <div className="detail-grid"><Detail label="Process ID" value={String(show.pid)} mono /><Detail label="Parent PID" value={String(show.ppid)} mono /><Detail label="User" value={`${show.user} · UID ${show.uid}`} /><Detail label="Kernel state" value={`${show.state} · ${show.stateLabel}`} /><Detail label="Started" value={show.startTimeUnix > 0 ? new Date(show.startTimeUnix * 1000).toLocaleString() : "Unavailable"} /><Detail label="Resident memory" value={formatBytes(show.memoryBytes)} /><Detail label="CPU time" value={`${((show.cpuTimeNs ?? 0) / 1e9).toFixed(2)} s`} /><Detail label="User CPU time" value={`${(show.userTimeNs / 1e9).toFixed(2)} s`} /><Detail label="System CPU time" value={`${(show.systemTimeNs / 1e9).toFixed(2)} s`} /></div>
        <div className="inspector-actions"><button className="button button-quiet" onClick={() => goTo("monitor")}><Activity size={15} /> Monitor process</button><button className="button button-quiet" onClick={() => goTo("control")}><Settings2 size={15} /> Control process</button></div>
      </> : <EmptyState icon={Search} title="Choose a process to inspect" description="Enter a PID or select a row from the process dashboard." />}
    </section>
  </>;
}

function PageIntro({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="page-intro"><div><div className="eyebrow">{eyebrow}</div><h1>{title}</h1><p>{description}</p></div>{action}</div>;
}

function Detail({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return <div className="detail-item"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}

function ProcessControl({ selectedPid, notify, onChanged }: { selectedPid: number | null; notify: (message: string, type?: Toast["type"]) => void; onChanged: () => void }) {
  const [pid, setPid] = useState(selectedPid ? String(selectedPid) : "");
  const [confirm, setConfirm] = useState<"stop" | "continue" | "terminate" | "kill" | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (selectedPid) setPid(String(selectedPid)); }, [selectedPid]);
  async function runControl() {
    if (!confirm) return;
    const targetPid = Number(pid.trim());
    if (!/^\d+$/.test(pid.trim()) || !Number.isSafeInteger(targetPid) || targetPid < 1) {
      notify("Enter a valid positive PID before sending a signal.", "error");
      setConfirm(null);
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ state: string; stateLabel: string }>(`/processes/${targetPid}/control`, { method: "POST", body: JSON.stringify({ action: confirm }) });
      notify(`PID ${targetPid}: ${confirm} verified, ${result.stateLabel} (state ${result.state}).`, "success");
      onChanged();
    }
    catch (error) { notify((error as Error).message, "error"); }
    finally { setBusy(false); setConfirm(null); }
  }
  const destructive = confirm === "terminate" || confirm === "kill";
  return <><PageIntro eyebrow="SIGNAL DELIVERY" title="Process Control" description="Send Linux signals to a process. Terminate and kill actions require confirmation." />
    <section className="data-panel control-panel"><div className="pid-form"><label>Target PID<input inputMode="numeric" value={pid} onChange={(event) => setPid(event.target.value)} placeholder="Enter PID" /></label><span className="control-hint">Signals are sent by the C process monitor running in Linux.</span></div>
      <div className="signal-grid"><SignalAction label="Stop" detail="Pause execution · SIGSTOP" icon={Pause} tone="amber" onClick={() => setConfirm("stop")} /><SignalAction label="Continue" detail="Resume execution · SIGCONT" icon={Play} onClick={() => setConfirm("continue")} /><SignalAction label="Terminate" detail="Request graceful exit · SIGTERM" icon={Power} tone="red" onClick={() => setConfirm("terminate")} /><SignalAction label="Kill" detail="Force immediate exit · SIGKILL" icon={X} tone="red" onClick={() => setConfirm("kill")} /></div>
    </section>
    {confirm && <ConfirmDialog title={`${confirm[0].toUpperCase()}${confirm.slice(1)} PID ${pid}?`} detail={`This sends SIG${{ stop: "STOP", continue: "CONT", terminate: "TERM", kill: "KILL" }[confirm]} to process ${pid}.${destructive ? " This operation may end the process and cannot be undone." : ""}`} confirmLabel={`Send ${confirm}`} danger={destructive} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void runControl()} />}
  </>;
}

function SignalAction({ label, detail, icon: Icon, tone = "green", onClick }: { label: string; detail: string; icon: LucideIcon; tone?: string; onClick: () => void }) {
  return <button className={`signal-action signal-${tone}`} onClick={onClick}><span><Icon size={17} /></span><strong>{label}</strong><small>{detail}</small><ChevronRight size={15} className="signal-arrow" /></button>;
}

function CreationPage({ notify, onCreated }: { notify: (message: string, type?: Toast["type"]) => void; onCreated: (pid: number) => void }) {
  const [mode, setMode] = useState<"command" | "file">("command");
  const [command, setCommand] = useState("sleep");
  const [launchDuration, setLaunchDuration] = useState("60");
  const [filename, setFilename] = useState("process-created.txt");
  const [created, setCreated] = useState<{ pid: number; command?: string; file?: string; kind: string } | null>(null);
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setCreated(null);
    try {
      const result = await request<{ pid: number; command?: string; file?: string; kind: string }>("/processes/create", { method: "POST", body: JSON.stringify(mode === "file" ? { filename } : { command, duration: Number(launchDuration) }) });
      setCreated(result); onCreated(result.pid); notify(`Created process ${result.pid}.`, "success");
    } catch (error) { notify((error as Error).message, "error"); }
    finally { setBusy(false); }
  }
  return <><PageIntro eyebrow="FORK + EXEC" title="Process Creation & Launch" description="Create a supervised child process through the C backend. Launch targets are intentionally allowlisted." />
    <section className="data-panel creation-panel"><div className="segmented-control"><button className={mode === "command" ? "selected" : ""} onClick={() => setMode("command")}><Terminal size={15} /> Launch command</button><button className={mode === "file" ? "selected" : ""} onClick={() => setMode("file")}><FilePlus2 size={15} /> Create file using a process</button></div>
      <form onSubmit={(event) => void submit(event)} className="creation-form">
        {mode === "command" ? <><label>Allowed command<select value={command} onChange={(event) => setCommand(event.target.value)}><option value="sleep">sleep</option><option value="yes">yes (auto-terminated after 20 seconds)</option></select></label>{command === "sleep" && <label>Duration in seconds<input type="number" min="1" max="3600" step="1" value={launchDuration} onChange={(event) => setLaunchDuration(event.target.value)} /></label>}<div className="notice-line"><ShieldAlert size={15} /><span>No shell is involved. The API accepts only <code>sleep</code> and <code>yes</code>.</span></div></> : <><label>New file name<input value={filename} onChange={(event) => setFilename(event.target.value)} maxLength={64} /><small>Created in the project root; existing files are never overwritten.</small></label></>}
        <button className="button button-primary" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Play size={15} />}{mode === "command" ? "Create process" : "Create file process"}</button>
      </form>
      {created && <div className="created-result"><div className="result-check"><Zap size={17} /></div><div><span className="eyebrow">PROCESS CREATED</span><strong>PID {created.pid}</strong><span>{created.command ?? `File: ${created.file}`} · tracked for application cleanup</span></div><Badge tone="green">Started</Badge></div>}
    </section>
  </>;
}

function ProcessTelemetryChart({ title, subtitle, data, dataKey, color, unit }: {
  title: string; subtitle: string; data: ProcessTelemetryPoint[];
  dataKey: "cpu" | "memory" | "userTime" | "systemTime"; color: string; unit: string;
}) {
  const values = data.map((point) => point[dataKey]).filter((value): value is number => value !== null && Number.isFinite(value));
  return <section className="chart-panel"><div className="chart-heading"><div><h3>{title}</h3><span>{subtitle}</span></div><span className="chart-current" style={{ color }}>{values.length ? `${values.at(-1)!.toFixed(1)}${unit}` : "—"}</span></div>
    <div className="chart-canvas">{values.length === 0 ? <div className="chart-empty">Start monitoring to collect samples</div> : <ResponsiveContainer width="100%" height="100%"><LineChart data={data} margin={{ top: 6, right: 8, left: -22, bottom: 0 }}>
      <CartesianGrid stroke="#28302b" strokeDasharray="3 5" vertical={false} /><XAxis dataKey="time" tick={{ fill: "#758078", fontSize: 10 }} axisLine={false} tickLine={false} minTickGap={28} />
      <YAxis domain={[0, "auto"]} tick={{ fill: "#758078", fontSize: 10 }} axisLine={false} tickLine={false} width={40} />
      <Tooltip contentStyle={{ background: "#171c18", border: "1px solid #343d36", borderRadius: 6, color: "#e5ebe6", fontSize: 12 }} formatter={(value: number) => [`${value.toFixed(2)}${unit}`, title]} />
      <Line type="monotone" dataKey={dataKey} stroke={color} strokeWidth={2} dot={false} connectNulls isAnimationActive={false} />
    </LineChart></ResponsiveContainer>}</div>
  </section>;
}

function LiveProcessPage({ selectedPid }: { selectedPid: number | null }) {
  const [pid, setPid] = useState(selectedPid ? String(selectedPid) : "");
  const [duration, setDuration] = useState("10");
  const [monitoring, setMonitoring] = useState<{ pid: number; duration: number; startedAt: number } | null>(null);
  const [snapshot, setSnapshot] = useState<ProcessResourceSample | null>(null);
  const [samples, setSamples] = useState<ProcessTelemetryPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    if (selectedPid) setPid(String(selectedPid));
  }, [selectedPid]);
  useEffect(() => {
    if (!monitoring) return;
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await request<ProcessResourceSample>(`/processes/${monitoring.pid}/resources`);
        if (active) {
          if (result.pid !== monitoring.pid || !Number.isFinite(result.memoryBytes) || !Number.isFinite(result.userTimeNs) || !Number.isFinite(result.systemTimeNs)) {
            throw new Error("The backend returned invalid process telemetry.");
          }
          setSnapshot(result);
          setUpdatedAt(result.updatedAt);
          setError("");
          setSamples((previous) => [...previous, {
            time: timeOf(result.updatedAt),
            cpu: result.cpuPercent,
            memory: result.memoryBytes / (1024 * 1024),
            userTime: result.userTimeNs / 1e9,
            systemTime: result.systemTimeNs / 1e9,
          }].slice(-(monitoring.duration + 1)));
        }
      } catch (requestError) {
        if (active) setError((requestError as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => {
      if (Date.now() - monitoring.startedAt >= monitoring.duration * 1000) {
        setMonitoring(null);
        setComplete(true);
        return;
      }
      void refresh();
    }, 1000);
    return () => { active = false; window.clearInterval(timer); };
  }, [monitoring]);
  function start(event: React.FormEvent) {
    event.preventDefault();
    const targetPid = Number(pid.trim());
    if (!/^\d+$/.test(pid.trim()) || !Number.isSafeInteger(targetPid) || targetPid < 1) {
      setError("Enter a valid positive PID.");
      return;
    }
    setSamples([]);
    setSnapshot(null);
    setUpdatedAt(null);
    setError("");
    setComplete(false);
    setMonitoring({ pid: targetPid, duration: Number(duration), startedAt: Date.now() });
  }
  const currentCpu = snapshot?.cpuPercent;
  const currentUserTime = snapshot?.userTimeNs === undefined ? null : snapshot.userTimeNs / 1e9;
  const currentSystemTime = snapshot?.systemTimeNs === undefined ? null : snapshot.systemTimeNs / 1e9;
  return <>
    <PageIntro eyebrow="PER-PROCESS STREAM" title="Live Process Monitoring" description="Sample a selected process at one-second intervals for a bounded monitoring window." action={<span className="updated-chip">{updatedAt ? `Updated ${timeOf(updatedAt)}` : monitoring ? "Sampling…" : "Ready"}</span>} />
    <section className="data-panel telemetry-controls"><form className="telemetry-form" onSubmit={start}>
      <label>Target PID<input inputMode="numeric" value={pid} onChange={(event) => setPid(event.target.value)} placeholder="Enter PID" disabled={Boolean(monitoring)} /></label>
      <label>Duration<select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={Boolean(monitoring)}><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="300">5 minutes</option></select></label>
      {monitoring
        ? <button className="button button-quiet" type="button" onClick={() => { setMonitoring(null); setComplete(false); }}><Square size={14} /> Stop monitoring</button>
        : <button className="button button-primary"><Play size={14} /> Start monitoring</button>}
    </form></section>
    {error && <div className="monitor-error" role="alert"><AlertTriangle size={15} />{error}</div>}
    <div className="detail-strip process-detail-strip">
      <Detail label="Process" value={snapshot ? `${snapshot.name} · PID ${snapshot.pid}` : monitoring ? `PID ${monitoring.pid}` : "No process selected"} mono />
      <Detail label="Status" value={snapshot?.state ?? (monitoring ? "Sampling" : complete ? "Complete" : "Ready")} />
      <Detail label="CPU" value={formatPercent(currentCpu)} mono />
      <Detail label="Memory" value={snapshot ? `${(snapshot.memoryBytes / (1024 * 1024)).toFixed(1)} MB` : "—"} mono />
      <Detail label="User CPU time" value={currentUserTime === null ? "—" : `${currentUserTime.toFixed(2)} s`} mono />
      <Detail label="System CPU time" value={currentSystemTime === null ? "—" : `${currentSystemTime.toFixed(2)} s`} mono />
    </div>
    <div className="chart-grid process-chart-grid">
      <ProcessTelemetryChart title="CPU usage" subtitle="Percent of one CPU core" data={samples} dataKey="cpu" color="#a2e66c" unit="%" />
      <ProcessTelemetryChart title="Resident memory" subtitle="RSS from /proc · MB" data={samples} dataKey="memory" color="#55c7bf" unit=" MB" />
      <ProcessTelemetryChart title="User CPU time" subtitle="Accumulated process time" data={samples} dataKey="userTime" color="#e5b761" unit=" s" />
      <ProcessTelemetryChart title="System CPU time" subtitle="Accumulated kernel time" data={samples} dataKey="systemTime" color="#7e9fe8" unit=" s" />
    </div>
  </>;
}

function ResourceMonitorPage() {
  const [snapshot, setSnapshot] = useState<SystemResources | null>(null);
  const [data, setData] = useState<SystemResourcePoint[]>([]);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    let inFlight = false;
    const refresh = async () => {
      if (inFlight) return;
      inFlight = true;
      try {
        const result = await request<SystemResources>("/system/resources");
        if (active) {
          setSnapshot(result);
          setError("");
          setData((previous) => [...previous.slice(-59), {
            time: timeOf(result.updatedAt),
            cpu: result.cpuPercent,
            memory: result.memoryPercent,
            swap: result.swapPercent,
            load: result.loadAverage[0] ?? null,
            diskRead: result.diskReadBytesPerSecond === null ? null : result.diskReadBytesPerSecond / 1024,
            diskWrite: result.diskWriteBytesPerSecond === null ? null : result.diskWriteBytesPerSecond / 1024,
            networkReceived: result.networkReceivedBytesPerSecond === null ? null : result.networkReceivedBytesPerSecond / 1024,
            networkSent: result.networkSentBytesPerSecond === null ? null : result.networkSentBytesPerSecond / 1024,
          }]);
        }
      } catch (requestError) {
        if (active) setError((requestError as Error).message);
      } finally {
        inFlight = false;
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);
  return <>
    <PageIntro eyebrow="HOST-WIDE RESOURCE TELEMETRY" title="Resource Monitor" description="System-wide Linux CPU, memory, swap, filesystem, disk I/O, network I/O, and load metrics from /proc and the root filesystem." action={<span className="updated-chip">{snapshot ? `Updated ${timeOf(snapshot.updatedAt)}` : "Connecting…"}</span>} />
    <div className="monitor-summary">
      <span><i className="pulse-dot" /> SYSTEM RESOURCES · AUTO REFRESH EVERY 2 SECONDS</span>
      <span>{snapshot ? `${snapshot.processCount.toLocaleString()} host processes` : "Waiting for host metrics"}</span>
    </div>
    {error && <div className="monitor-error" role="alert"><AlertTriangle size={15} />{error}</div>}
    {snapshot && <>
      <div className="metric-grid resource-metrics">
        <Metric label="Total CPU usage" value={formatPercent(snapshot.cpuPercent)} detail="All host CPU time from /proc/stat" icon={Cpu} />
        <Metric label="Used RAM" value={formatBytes(snapshot.memoryUsedBytes)} detail={`${formatPercent(snapshot.memoryPercent)} of ${formatBytes(snapshot.memoryTotalBytes)}`} icon={HardDrive} />
        <Metric label="Available RAM" value={formatBytes(snapshot.memoryAvailableBytes)} detail={`${formatBytes(snapshot.memoryFreeBytes)} completely free`} icon={Activity} tone="neutral" />
        <Metric label="Swap in use" value={formatBytes(snapshot.swapUsedBytes)} detail={`${formatPercent(snapshot.swapPercent)} of ${formatBytes(snapshot.swapTotalBytes)}`} icon={Gauge} tone="amber" />
        <Metric label="Root filesystem used" value={formatBytes(snapshot.diskUsedBytes)} detail={`${formatBytes(snapshot.diskAvailableBytes)} available of ${formatBytes(snapshot.diskTotalBytes)}`} icon={HardDrive} tone="neutral" />
        <Metric label="System load average" value={snapshot.loadAverage.map((value) => value.toFixed(2)).join(" · ")} detail="1, 5, and 15 minute averages" icon={Activity} />
      </div>
      <section className="data-panel cpu-core-panel">
        <div className="table-heading"><div><h2>CPU core usage</h2><span>Per-core utilization from Linux /proc/stat</span></div></div>
        <div className="cpu-core-grid">{snapshot.cpuCores.map((core) => <div className="cpu-core" key={core.name}><span>{core.name.toUpperCase()}</span><strong>{formatPercent(core.cpuPercent)}</strong><div className="meter"><i style={{ width: `${Math.min(core.cpuPercent ?? 0, 100)}%` }} /></div></div>)}</div>
      </section>
      <div className="chart-grid">
        <ChartPanel title="Total CPU usage" subtitle="Host-wide busy CPU time · %" data={data} dataKey="cpu" color="#a2e66c" />
        <ChartPanel title="RAM usage" subtitle="Used physical memory · %" data={data} dataKey="memory" color="#55c7bf" />
        <ChartPanel title="Swap usage" subtitle="Used swap space · %" data={data} dataKey="swap" color="#e5b761" />
        <ChartPanel title="System load average" subtitle="One-minute host load average" data={data} dataKey="load" color="#7e9fe8" unit="" />
        <ChartPanel title="Disk reads" subtitle="Host block-device read · KiB/s" data={data} dataKey="diskRead" color="#a2e66c" unit=" KiB/s" />
        <ChartPanel title="Disk writes" subtitle="Host block-device write · KiB/s" data={data} dataKey="diskWrite" color="#e5b761" unit=" KiB/s" />
        <ChartPanel title="Network received" subtitle="Non-loopback host traffic · KiB/s" data={data} dataKey="networkReceived" color="#55c7bf" unit=" KiB/s" />
        <ChartPanel title="Network sent" subtitle="Non-loopback host traffic · KiB/s" data={data} dataKey="networkSent" color="#7e9fe8" unit=" KiB/s" />
      </div>
    </>}
    {!snapshot && !error && <section className="data-panel"><EmptyState icon={Gauge} title="Loading system resources" description="Reading system counters directly from Linux /proc and the root filesystem." /></section>}
  </>;
}

function TreeNode({ processInfo, childrenByParent, selectedPid, onSelect, expanded, toggle, depth = 0, visible, ancestors = new Set<number>() }: {
  processInfo: ProcessInfo; childrenByParent: Map<number, ProcessInfo[]>; selectedPid: number | null;
  onSelect: (processInfo: ProcessInfo) => void; expanded: Set<number>; toggle: (pid: number) => void; depth?: number; visible: Set<number> | null;
  ancestors?: Set<number>;
}) {
  const branch = new Set<number>(ancestors);
  branch.add(processInfo.pid);
  const children = (childrenByParent.get(processInfo.pid) ?? []).filter((child) =>
    (!visible || visible.has(child.pid)) && !branch.has(child.pid),
  );
  const isOpen = expanded.has(processInfo.pid) || visible !== null;
  return <div className="tree-branch"><div className={`tree-row ${selectedPid === processInfo.pid ? "tree-selected" : ""}`} style={{ paddingLeft: `${depth * 21 + 8}px` }}>
    <button className="tree-toggle" aria-label={isOpen ? "Collapse process children" : "Expand process children"} onClick={() => toggle(processInfo.pid)}>{children.length ? (isOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />) : <span className="tree-leaf" />}</button>
    <button className="tree-process" onClick={() => onSelect(processInfo)}><span className="tree-pid">{processInfo.pid}</span><strong>{processInfo.name}</strong><span className="tree-ppid">PPID {processInfo.ppid}</span><Badge tone={processInfo.stateLabel === "Running" ? "green" : "neutral"}>{processInfo.stateLabel}</Badge></button>
  </div>{isOpen && children.map((child) => <TreeNode key={child.pid} processInfo={child} childrenByParent={childrenByParent} selectedPid={selectedPid} onSelect={onSelect} expanded={expanded} toggle={toggle} depth={depth + 1} visible={visible} ancestors={branch} />)}</div>;
}

function ProcessTree({ processes, selectedPid, onSelect }: { processes: ProcessInfo[]; selectedPid: number | null; onSelect: (process: ProcessInfo) => void }) {
  const [query, setQuery] = useState("");
  const [zoom, setZoom] = useState(1);
  const [expanded, setExpanded] = useState(() => new Set<number>([1]));
  const byPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  const childrenByParent = new Map<number, ProcessInfo[]>();
  for (const processInfo of processes) {
    const children = childrenByParent.get(processInfo.ppid) ?? [];
    children.push(processInfo); childrenByParent.set(processInfo.ppid, children);
  }
  const visible = query.trim() ? new Set<number>() : null;
  if (visible) {
    for (const item of processes) if (`${item.pid} ${item.name}`.toLowerCase().includes(query.toLowerCase())) {
      let cursor: ProcessInfo | undefined = item;
      const visited = new Set<number>();
      while (cursor && !visited.has(cursor.pid)) { visible.add(cursor.pid); visited.add(cursor.pid); cursor = byPid.get(cursor.ppid); }
    }
  }
  const roots = processes.filter((item) => !byPid.has(item.ppid)).sort((a, b) => a.pid - b.pid);
  const included = new Set<number>();
  const pending = [...roots];
  while (pending.length > 0) {
    const current = pending.pop()!;
    if (included.has(current.pid)) continue;
    included.add(current.pid);
    pending.push(...(childrenByParent.get(current.pid) ?? []));
  }
  for (const processInfo of processes) {
    if (included.has(processInfo.pid)) continue;
    roots.push(processInfo);
    pending.push(processInfo);
    while (pending.length > 0) {
      const current = pending.pop()!;
      if (included.has(current.pid)) continue;
      included.add(current.pid);
      pending.push(...(childrenByParent.get(current.pid) ?? []));
    }
  }
  return <><PageIntro eyebrow="LIVE PPID RELATIONSHIPS" title="Process Tree" description="Parent-child edges are derived from the PID and PPID values reported by the Linux C backend." />
    <section className="data-panel tree-panel"><div className="tree-toolbar"><label className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Find a PID or process" /></label><div className="tree-tools"><span>{processes.length.toLocaleString()} live nodes</span><button className="icon-button" title="Zoom out" aria-label="Zoom out" onClick={() => setZoom((value) => Math.max(.65, Number((value - .1).toFixed(2))))}><ZoomOut size={15} /></button><button className="icon-button" title="Reset zoom" aria-label="Reset zoom" onClick={() => setZoom(1)}><Maximize2 size={14} /></button><button className="icon-button" title="Zoom in" aria-label="Zoom in" onClick={() => setZoom((value) => Math.min(1.5, Number((value + .1).toFixed(2))))}><ZoomIn size={15} /></button></div></div>
      <div className="tree-viewport" style={{ zoom }}>{roots.length === 0 ? <EmptyState icon={GitFork} title="No process data" description="Refresh the dashboard to retrieve current process relationships." /> : roots.map((root) => <TreeNode key={root.pid} processInfo={root} childrenByParent={childrenByParent} selectedPid={selectedPid} onSelect={onSelect} expanded={expanded} toggle={(pid) => setExpanded((current) => { const next = new Set(current); next.has(pid) ? next.delete(pid) : next.add(pid); return next; })} visible={visible} />)}</div>
      <footer className="table-footer"><span>Click a process row to inspect its details.</span><span>Scroll to pan · expand branches to navigate</span></footer>
    </section>
  </>;
}

function PriorityPage({ selectedPid, notify }: { selectedPid: number | null; notify: (message: string, type?: Toast["type"]) => void }) {
  const [pid, setPid] = useState(selectedPid ? String(selectedPid) : "");
  const [priority, setPriority] = useState<number | null>(null);
  const [policy, setPolicy] = useState<SchedulingPolicy | null>(null);
  const [selectedPolicy, setSelectedPolicy] = useState<SettableSchedulingPolicy>("normal");
  const [actionError, setActionError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (selectedPid) {
      setPid(String(selectedPid));
      setPriority(null);
      setPolicy(null);
      setActionError("");
    }
  }, [selectedPid]);
  async function readSettings() {
    const targetPid = Number(pid.trim());
    if (!/^\d+$/.test(pid.trim()) || !Number.isSafeInteger(targetPid) || targetPid < 1) {
      notify("Enter a valid positive PID.", "error");
      return;
    }
    setBusy(true);
    try {
      const [priorityResult, schedulingResult] = await Promise.all([
        request<{ pid: number; priority: number }>(`/processes/${targetPid}/priority`),
        request<{ pid: number; policy: SchedulingPolicy }>(`/processes/${targetPid}/scheduling`),
      ]);
      if (priorityResult.pid !== targetPid || !Number.isInteger(priorityResult.priority) || priorityResult.priority < -20 || priorityResult.priority > 19) {
        throw new Error("The backend returned an invalid Linux nice value.");
      }
      if (schedulingResult.pid !== targetPid || !["normal", "batch", "idle", "other"].includes(schedulingResult.policy)) {
        throw new Error("The backend returned an invalid Linux scheduling policy.");
      }
      setPriority(priorityResult.priority);
      setPolicy(schedulingResult.policy);
      setActionError("");
      if (schedulingResult.policy === "normal" || schedulingResult.policy === "batch") {
        setSelectedPolicy(schedulingResult.policy);
      }
    } catch (error) {
      setPriority(null);
      setPolicy(null);
      const message = (error as Error).message;
      setActionError(message);
      notify(message, "error");
    }
    finally { setBusy(false); }
  }
  async function adjust(delta: -1 | 1) {
    const targetPid = Number(pid.trim());
    if (!/^\d+$/.test(pid.trim()) || !Number.isSafeInteger(targetPid) || targetPid < 1) {
      notify("Enter a valid positive PID.", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ pid: number; priority: number }>(`/processes/${targetPid}/priority`, { method: "POST", body: JSON.stringify({ delta }) });
      if (result.pid !== targetPid || !Number.isInteger(result.priority) || result.priority < -20 || result.priority > 19) {
        throw new Error("The backend returned an invalid Linux nice value.");
      }
      setPriority(result.priority);
      setActionError("");
      notify(`Linux reports the nice value is now ${result.priority}.`, "success");
    }
    catch (error) {
      const message = (error as Error).message;
      setActionError(message);
      notify(message, "error");
    }
    finally { setBusy(false); }
  }
  async function applyScheduling() {
    const targetPid = Number(pid.trim());
    if (!/^\d+$/.test(pid.trim()) || !Number.isSafeInteger(targetPid) || targetPid < 1) {
      notify("Enter a valid positive PID.", "error");
      return;
    }
    setBusy(true);
    try {
      const result = await request<{ pid: number; policy: SchedulingPolicy }>(`/processes/${targetPid}/scheduling`, {
        method: "POST", body: JSON.stringify({ policy: selectedPolicy }),
      });
      if (result.pid !== targetPid || result.policy !== selectedPolicy) {
        throw new Error("Linux did not confirm the requested scheduling policy.");
      }
      setPolicy(result.policy);
      setActionError("");
      notify(`PID ${targetPid} now uses the ${result.policy} scheduling policy.`, "success");
    } catch (error) {
      const message = (error as Error).message;
      setActionError(message);
      notify(message, "error");
    }
    finally { setBusy(false); }
  }
  return <><PageIntro eyebrow="GETPRIORITY + SCHED_SETSCHEDULER" title="Priority & Scheduling" description="Read or adjust the Linux nice value and choose a normal or batch scheduling policy for a process." />
    <section className="data-panel priority-panel">
      <form className="pid-form priority-target-form" onSubmit={(event) => { event.preventDefault(); void readSettings(); }}>
        <label>Target PID<input inputMode="numeric" value={pid} onChange={(event) => { setPid(event.target.value); setPriority(null); setPolicy(null); setActionError(""); }} placeholder="Enter PID" disabled={busy} /></label>
        <button className="button button-quiet" disabled={busy}>{busy ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />} Read scheduling settings</button>
      </form>
      {actionError && <div className="priority-error" role="alert"><AlertTriangle size={15} /><span>{actionError}{actionError.toLowerCase().includes("permission") && !actionError.toLowerCase().includes("cap_sys_nice") ? " Use a process owned by your account; system processes such as PID 1 are protected." : ""}</span></div>}
      <div className="priority-settings-grid">
        <section className="priority-setting"><div className="panel-title"><div><span className="eyebrow">NICE · -20 TO 19</span><h2>Process priority</h2></div><ArrowUpWideNarrow size={17} /></div>
          <div className="priority-value"><strong>{priority ?? "—"}</strong><span>{priority === null ? "Read process settings to begin" : priority < 0 ? "Higher priority than default" : priority > 0 ? "Lower priority than default" : "Default priority"}</span></div>
          <div className="priority-actions"><button className="button button-quiet" disabled={busy || priority === null || priority <= -20} onClick={() => void adjust(-1)}><ArrowUpWideNarrow size={15} /> Raise priority <small>nice −1</small></button><button className="button button-quiet" disabled={busy || priority === null || priority >= 19} onClick={() => void adjust(1)}><ArrowDownWideNarrow size={15} /> Lower priority <small>nice +1</small></button></div>
        </section>
        <section className="priority-setting"><div className="panel-title"><div><span className="eyebrow">SCHED_SETSCHEDULER</span><h2>Scheduling policy</h2></div><Timer size={17} /></div>
          <div className="policy-current"><span>Current policy</span><strong>{policy === null ? "—" : policy === "other" ? "Other / real-time" : policy[0].toUpperCase() + policy.slice(1)}</strong></div>
          {policy === "idle" && <div className="policy-lock-note" role="status">Linux requires elevated privileges to switch an existing SCHED_IDLE process back to a normal policy. This control is disabled to avoid an unprivileged change that cannot be undone.</div>}
          <form className="policy-form" onSubmit={(event) => { event.preventDefault(); void applyScheduling(); }}>
            <label>Apply policy<select value={selectedPolicy} onChange={(event) => {
              const next = event.target.value;
              if (next === "normal" || next === "batch") setSelectedPolicy(next);
            }} disabled={busy || policy === null || policy === "idle"}>
              <option value="normal">Normal (SCHED_OTHER)</option><option value="batch">Batch (SCHED_BATCH)</option>
            </select></label>
            <button className="button button-primary" disabled={busy || policy === null || policy === "idle"}>{busy ? <LoaderCircle size={15} className="spin" /> : <Settings2 size={15} />} Apply policy</button>
          </form>
        </section>
      </div>
      <p className="muted-note priority-note">Use a PID owned by your account; system processes such as PID 1 are protected. Raising priority (lowering the nice value) may require Linux privileges. Normal and Batch policies can be switched without real-time scheduler privileges.</p>
    </section>
  </>;
}

function WatchdogPage({ notify }: { notify: (message: string, type?: Toast["type"]) => void }) {
  const [pid, setPid] = useState("");
  const [threshold, setThreshold] = useState("80");
  const [duration, setDuration] = useState("30");
  const [watchdog, setWatchdog] = useState<Watchdog | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!watchdog || !watchdog.running) return;
    const timer = window.setInterval(async () => {
      try { setWatchdog(await request<Watchdog>(`/watchdog/${watchdog.id}`)); }
      catch (error) { notify((error as Error).message, "error"); }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [watchdog?.id, watchdog?.running, notify]);
  async function start(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try { setWatchdog(await request<Watchdog>("/watchdog", { method: "POST", body: JSON.stringify({ pid: Number(pid), threshold: Number(threshold), duration: Number(duration) }) })); }
    catch (error) { notify((error as Error).message, "error"); }
    finally { setBusy(false); }
  }
  async function stop() { if (!watchdog) return; try { setWatchdog(await request<Watchdog>(`/watchdog/${watchdog.id}/stop`, { method: "POST" })); } catch (error) { notify((error as Error).message, "error"); } }
  const stateTone = watchdog?.status === "high" ? "red" : watchdog?.status === "warning" ? "amber" : watchdog?.status === "normal" ? "green" : "neutral";
  return <><PageIntro eyebrow="THRESHOLD MONITOR" title="Process Watchdog & Alerts" description="Monitor actual per-process CPU time and resident memory. Alerts are evaluated once per second." />
    <div className="watchdog-layout"><section className="data-panel watchdog-form-panel"><form className="watchdog-form" onSubmit={(event) => void start(event)}><label>Target PID<input inputMode="numeric" value={pid} onChange={(event) => setPid(event.target.value)} placeholder="Enter PID" disabled={Boolean(watchdog && !["complete", "exited"].includes(watchdog.status))} /></label><label>CPU alert threshold <span className="input-suffix"><input type="number" min="0" max="100" step="1" value={threshold} onChange={(event) => setThreshold(event.target.value)} disabled={Boolean(watchdog && !["complete", "exited"].includes(watchdog.status))} /><i>%</i></span></label><label>Monitoring duration<select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={Boolean(watchdog && !["complete", "exited"].includes(watchdog.status))}><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="300">5 minutes</option></select></label>
        {!watchdog || !watchdog.running ? <button className="button button-primary" disabled={busy}><ShieldAlert size={15} /> Start watchdog</button> : <button type="button" className="button button-quiet" onClick={() => void stop()}><Square size={14} /> Stop watchdog</button>}
      </form></section>
      <section className={`watchdog-status status-${stateTone}`}><span className="watchdog-icon"><ShieldAlert size={21} /></span><span className="eyebrow">CURRENT ASSESSMENT</span><h2>{watchdog ? watchdog.status === "high" ? "High CPU usage" : watchdog.status === "warning" ? "CPU warning" : watchdog.status === "exited" ? "Process unavailable" : watchdog.status === "complete" ? "Monitoring complete" : "Normal" : "Standby"}</h2>
        {watchdog ? <><p>PID {watchdog.pid} · CPU {formatPercent(watchdog.cpuPercent)} · {formatBytes(watchdog.memoryBytes)}</p><div className="watchdog-progress"><i style={{ width: `${Math.min(100, (watchdog.elapsed / watchdog.duration) * 100)}%` }} /></div><small>{watchdog.elapsed}s elapsed · threshold {watchdog.threshold}%{watchdog.running ? " · monitoring" : " · stopped"}</small></> : <p>Configure a process threshold to begin.</p>}
      </section></div>
    <div className="legend-row"><Badge tone="green">Normal</Badge><Badge tone="amber">Warning · 80% of threshold</Badge><Badge tone="red">High CPU · threshold reached</Badge></div>
  </>;
}

function LifecyclePage({ notify }: { notify: (message: string, type?: Toast["type"]) => void }) {
  const [duration, setDuration] = useState("30");
  const [state, setState] = useState<{ running: boolean; events: LifecycleEvent[] }>({ running: false, events: [] });
  const [busy, setBusy] = useState(false);
  const [clearedEventKeys, setClearedEventKeys] = useState<Set<string>>(() => new Set());
  useEffect(() => {
    let active = true;
    const load = async () => { try { const next = await request<{ running: boolean; events: LifecycleEvent[] }>("/lifecycle/events"); if (active) setState(next); } catch (error) { if (active) notify((error as Error).message, "error"); } };
    void load(); const timer = window.setInterval(() => void load(), state.running ? 1200 : 4000);
    return () => { active = false; window.clearInterval(timer); };
  }, [state.running, notify]);
  async function start() {
    setBusy(true);
    try { await request("/lifecycle/start", { method: "POST", body: JSON.stringify({ duration: Number(duration) }) }); setState((previous) => ({ ...previous, running: true })); notify("Lifecycle logger started. Events are also appended to process_events.log.", "success"); }
    catch (error) { notify((error as Error).message, "error"); }
    finally { setBusy(false); }
  }
  const events = state.events.filter((event) => !clearedEventKeys.has(lifecycleEventKey(event)));
  function download() {
    const csv = ["timestamp,event,pid,name", ...events.map((event) => [event.timestamp, event.event, event.pid, `"${event.name.replaceAll('"', '""')}"`].join(","))].join("\n");
    const link = document.createElement("a"); const objectUrl = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    link.href = objectUrl; link.download = "process-events.csv"; document.body.appendChild(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
  }
  function clearVisibleEvents() {
    setClearedEventKeys(new Set(state.events.map(lifecycleEventKey)));
  }
  return <><PageIntro eyebrow="PROCESS SNAPSHOT DIFF" title="Lifecycle / Event Logger" description="The C logger compares real /proc snapshots and appends STARTED / TERMINATED records to process_events.log." />
    <section className="data-panel lifecycle-toolbar"><div className="lifecycle-config"><label>Logging duration<select value={duration} onChange={(event) => setDuration(event.target.value)} disabled={state.running}><option value="10">10 seconds</option><option value="30">30 seconds</option><option value="60">60 seconds</option><option value="300">5 minutes</option></select></label>
      {!state.running ? <button className="button button-primary" onClick={() => void start()} disabled={busy}><Play size={15} /> Start logger</button> : <Badge tone="green">Logger active</Badge>}
    </div><div className="lifecycle-actions"><button className="button button-quiet" onClick={download}><FilePlus2 size={14} /> Download log</button><button className="button button-quiet" onClick={clearVisibleEvents}><X size={14} /> Clear UI log</button><button className="button button-quiet" onClick={async () => { try { setState(await request("/lifecycle/events")); } catch (error) { notify((error as Error).message, "error"); } }}><RefreshCw size={14} /> Refresh</button></div></section>
    <section className="data-panel event-panel"><div className="table-heading"><div><h2>Process events</h2><span>{events.length} visible · persisted in process_events.log</span></div><Badge tone={state.running ? "green" : "neutral"}>{state.running ? "Recording" : "Idle"}</Badge></div>
      <div className="event-table-wrap">{events.length === 0 ? <EmptyState icon={Timer} title="No lifecycle events in view" description="Start the logger and create or terminate a process to generate actual lifecycle records." /> : <table className="event-table"><thead><tr><th>Timestamp</th><th>Event</th><th>PID</th><th>Process name</th></tr></thead><tbody>{[...events].reverse().map((event, index) => <tr key={`${event.timestamp}-${event.pid}-${index}`}><td className="mono">{event.timestamp}</td><td><Badge tone={event.event === "STARTED" ? "green" : "red"}>{event.event}</Badge></td><td className="mono pid-cell">{event.pid}</td><td>{event.name}</td></tr>)}</tbody></table>}</div>
    </section>
  </>;
}

function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [processes, setProcesses] = useState<ProcessInfo[]>([]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [createdCount, setCreatedCount] = useState(0);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [selectedPid, setSelectedPid] = useState<number | null>(null);
  const [clock, setClock] = useState(new Date());
  const [loading, setLoading] = useState(true);
  const [backendError, setBackendError] = useState("");
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [exitConfirm, setExitConfirm] = useState(false);
  const [stopped, setStopped] = useState(false);
  const [exitBusy, setExitBusy] = useState(false);
  const refreshInFlight = useRef(false);
  const notify = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((previous) => [...previous, { id, message, type }]);
    window.setTimeout(() => setToasts((previous) => previous.filter((item) => item.id !== id)), 4200);
  }, []);
  async function refreshData(showToast = false) {
    if (refreshInFlight.current) return;
    refreshInFlight.current = true;
    setRefreshing(true);
    try {
      const [dashboard, created] = await Promise.all([
        request<{ processes: ProcessInfo[]; system: SystemStatus; updatedAt: string }>("/application/refresh", { method: "POST" }),
        request<{ count: number }>("/processes/created"),
      ]);
      setProcesses(dashboard.processes); setStatus(dashboard.system); setCreatedCount(created.count);
      setUpdatedAt(dashboard.updatedAt); setBackendError("");
      if (showToast) notify("Dashboard and system metrics refreshed.", "success");
    } catch (error) {
      setBackendError((error as Error).message);
    } finally { refreshInFlight.current = false; setLoading(false); setRefreshing(false); }
  }
  useEffect(() => { void refreshData(); const timer = window.setInterval(() => void refreshData(), 1500); return () => window.clearInterval(timer); }, []);
  useEffect(() => { const timer = window.setInterval(() => setClock(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  function navigate(id: PageId | "refresh" | "exit") {
    setMobileOpen(false);
    if (id === "refresh") { void refreshData(true); return; }
    if (id === "exit") { setExitConfirm(true); return; }
    setPage(id);
  }
  function selectProcess(processInfo: ProcessInfo) { setSelectedPid(processInfo.pid); setPage("inspector"); }
  async function exitApplication() {
    setExitBusy(true);
    try { await request("/application/exit", { method: "POST" }); setStopped(true); setExitConfirm(false); }
    catch (error) { notify((error as Error).message, "error"); setExitConfirm(false); }
    finally { setExitBusy(false); }
  }
  if (stopped) return <main className="stopped-screen"><div className="brand-mark"><Signal size={22} /></div><span className="eyebrow">SESSION CLOSED</span><h1>Application stopped</h1><p>The Node backend shut down and processes created by this session were sent SIGTERM.</p><span className="mono">Restart the backend in WSL to reconnect.</span></main>;
  const connected = !backendError && status !== null;
  return <div className="app-shell">
    {mobileOpen && <button className="mobile-scrim" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
    <aside className={`sidebar ${mobileOpen ? "sidebar-open" : ""}`}>
      <div className="brand"><div className="brand-mark"><Signal size={19} /></div><div><strong>proc<span>/</span>watch</strong><small>LINUX SYSTEMS</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)} aria-label="Close menu"><X size={18} /></button></div>
      <div className="nav-caption">PROCESS OPERATIONS</div><nav aria-label="Main navigation">
        {navigation.map(({ id, label, icon: Icon, number }, index) => <div key={id} className={index === 10 ? "nav-divider" : ""}>
          <button className={`nav-item ${page === id ? "nav-active" : ""} ${id === "exit" ? "nav-exit" : ""}`} onClick={() => navigate(id)}><Icon size={16} strokeWidth={1.8} /><span>{label}</span><small>{number}</small></button>
        </div>)}
      </nav>
      <div className="sidebar-status"><div className="sidebar-status-head"><span className={`pulse-dot ${connected ? "" : "offline"}`} />{connected ? "Linux system online" : "Backend disconnected"}</div><div className="sidebar-status-sub">Ubuntu / WSL · {connected ? "API connected" : "Waiting for API"}</div><div className="sidebar-backend"><span>BACKEND</span><Badge tone={connected ? "green" : "red"}>{connected ? "Connected" : "Offline"}</Badge></div></div>
      <div className="sidebar-version"><span>OS PROJECT</span><span>PROCESS MONITOR · 1.0</span></div>
    </aside>
    <main className="main-area">
      <header className="topbar"><div className="topbar-left"><button className="mobile-menu" aria-label="Open navigation" onClick={() => setMobileOpen(true)}><Menu size={19} /></button><div className="breadcrumb"><span>Linux Process Monitor</span><ChevronRight size={13} /><strong>{pageTitles[page]}</strong></div></div>
        <div className="topbar-meta"><span className="header-status"><i className={connected ? "" : "offline"} />{connected ? "Backend connected" : "Backend offline"}</span><span className="header-system"><span>HOST</span>Ubuntu / WSL</span><span className="header-clock mono">{clock.toLocaleTimeString([], { hour12: false })}</span><button className={`icon-button ${refreshing ? "" : ""}`} title="Refresh dashboard" aria-label="Refresh dashboard" onClick={() => void refreshData(true)} disabled={refreshing}><RefreshCw size={16} className={refreshing ? "spin" : ""} /></button></div>
      </header>
      {backendError && <div className="backend-banner"><AlertTriangle size={16} /><span>{backendError}</span><button onClick={() => void refreshData()}><RefreshCw size={14} /> Retry</button></div>}
      <div className="page-content" key={page}>
        {loading && processes.length === 0 && page === "dashboard" ? <div className="loading-view"><LoaderCircle className="spin" size={24} /><span>Connecting to Linux process backend…</span></div> : null}
        {page === "dashboard" && <Dashboard processes={processes} status={status} createdCount={createdCount} updatedAt={updatedAt} onSelect={selectProcess} onPage={setPage} />}
        {page === "inspector" && <ProcessInspector processes={processes} selectedPid={selectedPid} setSelectedPid={setSelectedPid} notify={notify} goTo={setPage} />}
        {page === "control" && <ProcessControl selectedPid={selectedPid} notify={notify} onChanged={() => void refreshData()} />}
        {page === "creation" && <CreationPage notify={notify} onCreated={(pid) => { setSelectedPid(pid); void refreshData(); }} />}
        {page === "monitor" && <LiveProcessPage selectedPid={selectedPid} />}
        {page === "resources" && <ResourceMonitorPage />}
        {page === "tree" && <ProcessTree processes={processes} selectedPid={selectedPid} onSelect={selectProcess} />}
        {page === "priority" && <PriorityPage selectedPid={selectedPid} notify={notify} />}
        {page === "watchdog" && <WatchdogPage notify={notify} />}
        {page === "lifecycle" && <LifecyclePage notify={notify} />}
        <footer className="page-footer"><span>Linux Process Monitoring and Control System</span><span>Data source <code>/proc</code> · Linux system APIs</span></footer>
      </div>
    </main>
    <ToastStack items={toasts} />
    {exitConfirm && <ConfirmDialog title="Stop the Process Monitor backend?" detail="The Node API will shut down and app-created processes will receive SIGTERM. Your terminal C menu is not affected." confirmLabel="Stop application" busy={exitBusy} onCancel={() => setExitConfirm(false)} onConfirm={() => void exitApplication()} />}
  </div>;
}

export default App;