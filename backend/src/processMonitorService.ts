import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

export class ServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

type RawProcess = {
  pid: number;
  ppid: number;
  name: string;
  state: string;
  cpuTimeNs: number;
  userTimeNs: number;
  systemTimeNs: number;
  memoryBytes: number;
  startTimeTicks: number;
  uid: number;
  user: string;
  executablePath?: string;
};

export type ProcessInfo = RawProcess & { stateLabel: string; cpuPercent: number | null };

type CpuSample = { cpuTimeNs: number; userTimeNs: number; systemTimeNs: number; at: number };
type RawMetrics = {
  processCount: number;
  cpuTotalTicks: number;
  cpuIdleTicks: number;
  memoryTotalBytes: number;
  memoryAvailableBytes: number;
};

export type SystemStatus = RawMetrics & {
  cpuPercent: number | null;
  memoryPercent: number | null;
  backend: "connected";
  system: "Linux / WSL";
  updatedAt: string;
};

export type LifecycleEvent = { timestamp: string; event: string; pid: number; name: string };
export type WatchdogSnapshot = {
  id: string;
  pid: number;
  threshold: number;
  duration: number;
  elapsed: number;
  running: boolean;
  status: "normal" | "warning" | "high" | "exited" | "complete";
  cpuPercent: number | null;
  memoryBytes: number;
  updatedAt: string;
};

type WatchdogJob = WatchdogSnapshot & { timer: NodeJS.Timeout };

const executable = resolve(
  process.env.PROCESS_MONITOR_BIN ?? resolve(process.cwd(), "../c_backend/process_monitor"),
);
const cWorkingDirectory = resolve(process.env.PROCESS_MONITOR_CWD ?? resolve(process.cwd(), ".."));
const cpuSamples = new Map<number, CpuSample>();
const createdPids = new Map<number, number>();
const watchdogs = new Map<string, WatchdogJob>();
const lifecycleEvents: LifecycleEvent[] = [];
let systemSample: { total: number; idle: number; at: number } | undefined;
let lifecycleChild: ChildProcess | undefined;
let lifecycleRunning = false;

function assertExecutable(): void {
  if (!existsSync(executable)) {
    throw new ServiceError(
      "The Linux C executable is missing. Run `make -C c_backend` from the project root.",
      503,
    );
  }
}

function runC<T>(args: string[], timeoutMs = 12_000): Promise<T> {
  assertExecutable();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(executable, ["--api", ...args], { cwd: cWorkingDirectory, shell: false, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (chunk: string) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", () => {
      clearTimeout(timeout);
      reject(new ServiceError("Unable to start the Linux C process monitor. Check the executable and permissions.", 503));
    });
    child.once("close", (code) => {
      clearTimeout(timeout);
      let response: unknown;
      try {
        response = JSON.parse(stdout.trim());
      } catch {
        reject(new ServiceError(code === null ? "The C operation timed out." : "The C process monitor returned an invalid response.", 502));
        return;
      }
      if (response && typeof response === "object" && "error" in response) {
        const message = String((response as { error: unknown }).error);
        const normalized = message.toLowerCase();
        const status = normalized.includes("does not exist") || normalized.includes("no such process")
          ? 404
          : normalized.includes("permission denied") ? 403
          : normalized.includes("timed out") ? 504
          : 400;
        reject(new ServiceError(message, status));
        return;
      }
      if (code !== 0) {
        reject(new ServiceError(stderr.trim() || "The C process monitor operation failed.", 502));
        return;
      }
      resolvePromise(response as T);
    });
  });
}

function validPid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ServiceError("Enter a valid positive PID.");
  }
  return value;
}

function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    R: "Running", S: "Sleeping", D: "Disk sleep", T: "Stopped", t: "Tracing",
    Z: "Zombie", X: "Dead", I: "Idle",
  };
  return labels[state] ?? "Unknown";
}

function sampleProcess(processInfo: RawProcess): ProcessInfo {
  const at = Date.now();
  const previous = cpuSamples.get(processInfo.pid);
  const cpuPercent = previous && at > previous.at
    ? Math.max(0, ((processInfo.cpuTimeNs - previous.cpuTimeNs) / ((at - previous.at) * 1_000_000)) * 100)
    : null;
  cpuSamples.set(processInfo.pid, {
    cpuTimeNs: processInfo.cpuTimeNs,
    userTimeNs: processInfo.userTimeNs,
    systemTimeNs: processInfo.systemTimeNs,
    at,
  });
  return { ...processInfo, stateLabel: stateLabel(processInfo.state), cpuPercent };
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const result = await runC<{ processes: RawProcess[] }>(["list"]);
  return result.processes.map(sampleProcess);
}

export async function inspectProcess(pidValue: number): Promise<ProcessInfo> {
  const pid = validPid(pidValue);
  const raw = await runC<RawProcess>(["inspect", String(pid)]);
  return sampleProcess(raw);
}

export async function processResources(pidValue: number) {
  const processInfo = await inspectProcess(pidValue);
  const sample = cpuSamples.get(processInfo.pid);
  return {
    pid: processInfo.pid,
    name: processInfo.name,
    state: processInfo.stateLabel,
    cpuPercent: processInfo.cpuPercent,
    memoryBytes: processInfo.memoryBytes,
    userTimeNs: sample?.userTimeNs ?? processInfo.userTimeNs,
    systemTimeNs: sample?.systemTimeNs ?? processInfo.systemTimeNs,
    updatedAt: new Date().toISOString(),
  };
}

export async function systemStatus(): Promise<SystemStatus> {
  const metrics = await runC<RawMetrics>(["metrics"]);
  const at = Date.now();
  const previous = systemSample;
  const elapsed = previous ? at - previous.at : 0;
  const totalDelta = previous ? metrics.cpuTotalTicks - previous.total : 0;
  const idleDelta = previous ? metrics.cpuIdleTicks - previous.idle : 0;
  const cpuPercent = totalDelta > 0 && elapsed > 0
    ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100))
    : null;
  systemSample = { total: metrics.cpuTotalTicks, idle: metrics.cpuIdleTicks, at };
  return {
    ...metrics,
    cpuPercent,
    memoryPercent: metrics.memoryTotalBytes > 0
      ? ((metrics.memoryTotalBytes - metrics.memoryAvailableBytes) / metrics.memoryTotalBytes) * 100
      : null,
    backend: "connected",
    system: "Linux / WSL",
    updatedAt: new Date(at).toISOString(),
  };
}

export async function controlProcess(pidValue: number, action: string) {
  const pid = validPid(pidValue);
  if (!["stop", "continue", "terminate", "kill"].includes(action)) throw new ServiceError("Unsupported process action.");
  const result = await runC<{ success: boolean; pid: number; action: string; state: string; stateLabel: string }>(["control", String(pid), action]);
  if (action === "terminate" || action === "kill") createdPids.delete(pid);
  return result;
}

async function rememberCreatedProcess(pid: number): Promise<void> {
  const identity = await runC<{ startTimeTicks: number }>(["inspect", String(pid)]);
  createdPids.set(pid, identity.startTimeTicks);
}

export async function createProcess(command: unknown, filename: unknown, durationValue: unknown) {
  if (typeof filename === "string") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(filename)) throw new ServiceError("Use a simple file name without a directory path.");
    const created = await runC<{ pid: number; file: string }>(["create-file", filename]);
    await rememberCreatedProcess(created.pid);
    return { ...created, kind: "file" as const };
  }
  if (command !== "sleep" && command !== "yes") throw new ServiceError("Allowed launch commands are `sleep <seconds>` and `yes`.");
  const duration = durationValue === undefined ? 60 : Number(durationValue);
  if (command === "sleep" && (!Number.isInteger(duration) || duration < 1 || duration > 3600)) {
    throw new ServiceError("sleep duration must be between 1 and 3600 seconds.");
  }
  const args = command === "sleep" ? [String(duration)] : [];
  const created = await runC<{ pid: number; command: string }>(["launch", String(command), ...args]);
  await rememberCreatedProcess(created.pid);
  if (command === "yes") {
    setTimeout(() => { void controlProcess(created.pid, "terminate").catch(() => undefined); }, 20_000).unref();
  }
  return { ...created, kind: "command" as const };
}

export async function getPriority(pidValue: number) {
  return runC<{ pid: number; priority: number }>(["priority", String(validPid(pidValue))]);
}

export async function adjustPriority(pidValue: number, delta: number) {
  if (delta !== -1 && delta !== 1) throw new ServiceError("Priority adjustment must be -1 or 1.");
  return runC<{ pid: number; priority: number }>(["priority", String(validPid(pidValue)), String(delta)]);
}

function rememberLifecycleEvent(event: LifecycleEvent): void {
  lifecycleEvents.push(event);
  if (lifecycleEvents.length > 500) lifecycleEvents.splice(0, lifecycleEvents.length - 500);
}

export function startLifecycle(duration: number) {
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new ServiceError("Logging duration must be between 1 and 3600 seconds.");
  if (lifecycleRunning) throw new ServiceError("The lifecycle logger is already running.", 409);
  assertExecutable();
  lifecycleRunning = true;
  const child = spawn(executable, ["--api", "lifecycle", String(duration)], { cwd: cWorkingDirectory, shell: false, stdio: ["ignore", "pipe", "ignore"] });
  lifecycleChild = child;
  let buffered = "";
  child.stdout?.setEncoding("utf8").on("data", (chunk: string) => {
    buffered += chunk;
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as LifecycleEvent | { done: boolean };
        if ("event" in event && "pid" in event) rememberLifecycleEvent(event);
      } catch { /* Ignore incomplete/non-event output. */ }
    }
  });
  child.once("close", () => {
    lifecycleRunning = false;
    lifecycleChild = undefined;
  });
  child.once("error", () => {
    lifecycleRunning = false;
    lifecycleChild = undefined;
  });
  return { running: true, duration };
}

export async function lifecycleState() {
  const saved = await runC<{ events: LifecycleEvent[] }>(["events"]);
  const combined = new Map<string, LifecycleEvent>();
  for (const event of [...saved.events, ...lifecycleEvents]) {
    combined.set(`${event.timestamp}:${event.event}:${event.pid}`, event);
  }
  return { running: lifecycleRunning, events: [...combined.values()].slice(-500) };
}

export async function startWatchdog(pidValue: number, threshold: number, duration: number) {
  const pid = validPid(pidValue);
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new ServiceError("CPU threshold must be between 0 and 100 percent.");
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new ServiceError("Monitoring duration must be between 1 and 3600 seconds.");
  const initial = await processResources(pid);
  const id = crypto.randomUUID();
  const job: WatchdogJob = {
    id, pid, threshold, duration, elapsed: 0, running: true, status: "normal",
    cpuPercent: initial.cpuPercent, memoryBytes: initial.memoryBytes,
    updatedAt: initial.updatedAt, timer: undefined as unknown as NodeJS.Timeout,
  };
  job.timer = setInterval(async () => {
    if (!job.running) return;
    job.elapsed++;
    try {
      const sample = await processResources(pid);
      job.cpuPercent = sample.cpuPercent;
      job.memoryBytes = sample.memoryBytes;
      job.updatedAt = sample.updatedAt;
      job.status = sample.cpuPercent !== null && sample.cpuPercent >= threshold
        ? "high"
        : sample.cpuPercent !== null && sample.cpuPercent >= threshold * 0.8 ? "warning" : "normal";
    } catch (error) {
      if (error instanceof ServiceError && error.status === 404) job.status = "exited";
      else job.status = "exited";
    }
    if (job.elapsed >= duration) {
      if (job.status !== "high" && job.status !== "warning" && job.status !== "exited") job.status = "complete";
      job.running = false;
      clearInterval(job.timer);
    }
  }, 1000);
  watchdogs.set(id, job);
  return watchdogSnapshot(job);
}

function watchdogSnapshot(job: WatchdogJob): WatchdogSnapshot {
  const { timer: _timer, ...snapshot } = job;
  return snapshot;
}

export function getWatchdog(id: string) {
  const job = watchdogs.get(id);
  if (!job) throw new ServiceError("Watchdog session not found.", 404);
  return watchdogSnapshot(job);
}

export function stopWatchdog(id: string) {
  const job = watchdogs.get(id);
  if (!job) throw new ServiceError("Watchdog session not found.", 404);
  clearInterval(job.timer);
  job.running = false;
  job.status = job.status === "high" || job.status === "warning" ? job.status : "complete";
  return watchdogSnapshot(job);
}

export async function refreshDashboard() {
  const [processes, system] = await Promise.all([listProcesses(), systemStatus()]);
  return { processes, system, updatedAt: new Date().toISOString() };
}

export async function shutdownApplication() {
  for (const job of watchdogs.values()) clearInterval(job.timer);
  lifecycleChild?.kill("SIGTERM");
  let cleanedProcesses = 0;
  const owned = [...createdPids.entries()];
  await Promise.all(owned.map(async ([pid, startTicks]) => {
    try {
      const current = await runC<{ startTimeTicks: number }>(["inspect", String(pid)]);
      if (current.startTimeTicks === startTicks) {
        await controlProcess(pid, "terminate");
        cleanedProcesses++;
      }
    } catch { /* The original process may already have exited. */ }
  }));
  createdPids.clear();
  return { stopped: true, cleanedProcesses };
}

export async function createdProcesses() {
  const processes = await listProcesses();
  const liveByPid = new Map(processes.map((processInfo) => [processInfo.pid, processInfo]));
  for (const [pid, startTicks] of createdPids) {
    if (liveByPid.get(pid)?.startTimeTicks !== startTicks) createdPids.delete(pid);
  }
  const owned = processes.filter((processInfo) => createdPids.get(processInfo.pid) === processInfo.startTimeTicks);
  return { count: owned.length, processes: owned };
}