import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { readFile, readdir, statfs } from "node:fs/promises";
import { loadavg } from "node:os";
import { resolve } from "node:path";

export class ServiceError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
  }
}

export type RawProcess = {
  pid: number;
  ppid: number;
  name: string;
  state: string;
  cpuTimeNs: number;
  userTimeNs: number;
  systemTimeNs: number;
  memoryBytes: number;
  startTimeTicks: number;
  startTimeUnix: number;
  uid: number;
  user: string;
  executablePath?: string;
};

export type ProcessInfo = RawProcess & {
  stateLabel: string;
  cpuPercent: number | null;
  command: string;
  memoryPercent: number | null;
  threadCount: number | null;
};
type SampledProcess = RawProcess & { stateLabel: string; cpuPercent: number | null };

type CpuSample = {
  cpuTimeNs: number;
  userTimeNs: number;
  systemTimeNs: number;
  startTimeTicks: number;
  cpuPercent: number | null;
  at: number;
};
type CpuTicks = { total: number; idle: number };
type DiskCounters = { readBytes: number; writeBytes: number };
type NetworkCounters = { receivedBytes: number; sentBytes: number };
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

export type SystemResources = {
  processCount: number;
  cpuPercent: number | null;
  cpuCores: { name: string; cpuPercent: number | null }[];
  memoryTotalBytes: number;
  memoryUsedBytes: number;
  memoryAvailableBytes: number;
  memoryFreeBytes: number;
  memoryPercent: number | null;
  swapTotalBytes: number;
  swapUsedBytes: number;
  swapFreeBytes: number;
  swapPercent: number | null;
  diskTotalBytes: number;
  diskUsedBytes: number;
  diskAvailableBytes: number;
  diskReadBytesPerSecond: number | null;
  diskWriteBytesPerSecond: number | null;
  networkReceivedBytesPerSecond: number | null;
  networkSentBytesPerSecond: number | null;
  loadAverage: number[];
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

export function findProjectRoot(startDir: string): string {
  const candidates = [startDir, resolve(startDir, ".."), resolve(startDir, "../..")];
  for (const directory of candidates) {
    if (
      existsSync(resolve(directory, "process_monitor.c")) ||
      existsSync(resolve(directory, "Makefile")) ||
      existsSync(resolve(directory, "c_backend"))
    ) {
      return directory;
    }
  }
  return resolve(startDir, "..");
}

export function findExecutable(projectRoot: string): string {
  const candidates = [
    resolve(projectRoot, "process_monitor"),
    resolve(projectRoot, "c_backend/process_monitor"),
    resolve(projectRoot, "../process_monitor"),
    resolve(projectRoot, "../c_backend/process_monitor"),
  ];
  return candidates.find((candidate) => existsSync(candidate)) ?? resolve(projectRoot, "process_monitor");
}

const projectRoot = findProjectRoot(process.cwd());
const executable = resolve(process.env.PROCESS_MONITOR_BIN ?? findExecutable(projectRoot));
const cWorkingDirectory = resolve(process.env.PROCESS_MONITOR_CWD ?? projectRoot);
const cpuSamples = new Map<number, CpuSample>();
const createdPids = new Map<number, number>();
const watchdogs = new Map<string, WatchdogJob>();
const lifecycleEvents: LifecycleEvent[] = [];
let systemSample: { total: number; idle: number; at: number } | undefined;
let lifecycleChild: ChildProcess | undefined;
let lifecycleRunning = false;
let resourceSample:
  | {
      at: number;
      cpu: Map<string, CpuTicks>;
      disk: DiskCounters;
      network: NetworkCounters;
    }
  | undefined;

function assertExecutable(): void {
  if (!existsSync(executable)) {
    throw new ServiceError(
      "The Linux C executable is missing. Build it with `make` from the project root or `make -C c_backend` if you are using the legacy backend layout.",
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

export function validPid(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) {
    throw new ServiceError("Enter a valid positive PID.");
  }
  return value;
}

export function stateLabel(state: string): string {
  const labels: Record<string, string> = {
    R: "Running", S: "Sleeping", D: "Disk sleep", T: "Stopped", t: "Tracing",
    Z: "Zombie", X: "Dead", I: "Idle",
  };
  return labels[state] ?? "Unknown";
}

export function sampleProcess(processInfo: RawProcess, samples: Map<number, CpuSample> = cpuSamples): SampledProcess {
  const at = Date.now();
  const previous = samples.get(processInfo.pid);
  let cpuPercent = previous?.cpuPercent ?? null;
  if (!previous || previous.startTimeTicks !== processInfo.startTimeTicks) {
    cpuPercent = null;
    samples.set(processInfo.pid, {
      cpuTimeNs: processInfo.cpuTimeNs,
      userTimeNs: processInfo.userTimeNs,
      systemTimeNs: processInfo.systemTimeNs,
      startTimeTicks: processInfo.startTimeTicks,
      cpuPercent,
      at,
    });
  } else if (processInfo.cpuTimeNs < previous.cpuTimeNs) {
    cpuPercent = previous.cpuPercent;
  } else if (at - previous.at >= 1000) {
    cpuPercent = at > previous.at
      ? Math.max(0, ((processInfo.cpuTimeNs - previous.cpuTimeNs) / ((at - previous.at) * 1_000_000)) * 100)
      : null;
    samples.set(processInfo.pid, {
      cpuTimeNs: processInfo.cpuTimeNs,
      userTimeNs: processInfo.userTimeNs,
      systemTimeNs: processInfo.systemTimeNs,
      startTimeTicks: processInfo.startTimeTicks,
      cpuPercent,
      at,
    });
  }
  return { ...processInfo, stateLabel: stateLabel(processInfo.state), cpuPercent };
}

export async function listProcesses(): Promise<ProcessInfo[]> {
  const result = await runC<{ processes: RawProcess[] }>(["list"]);
  const memoryInfo = parseMemInfo(await readLinuxFile("/proc/meminfo"));
  return Promise.all(result.processes.map(async (processInfo) => ({
    ...sampleProcess(processInfo),
    ...await processDetails(processInfo),
    memoryPercent: memoryInfo.totalBytes > 0
      ? (processInfo.memoryBytes / memoryInfo.totalBytes) * 100
      : null,
  })));
}

async function readLinuxFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    throw new ServiceError(
      code === "EACCES" || code === "EPERM"
        ? `Permission denied reading Linux system data from ${path}.`
        : `Unable to read Linux system data from ${path}.`,
      code === "EACCES" || code === "EPERM" ? 403 : 503,
    );
  }
}

async function readOptionalProcessFile(path: string): Promise<string> {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ESRCH" || code === "EACCES" || code === "EPERM") return "";
    throw error;
  }
}

export function parseMemInfo(contents: string) {
  const values = new Map<string, number>();
  for (const line of contents.split("\n")) {
    const match = /^(\w+):\s+(\d+)\s+kB$/.exec(line);
    if (match) values.set(match[1], Number(match[2]) * 1024);
  }
  const totalBytes = values.get("MemTotal") ?? 0;
  const availableBytes = values.get("MemAvailable") ?? values.get("MemFree") ?? 0;
  const freeBytes = values.get("MemFree") ?? 0;
  const swapTotalBytes = values.get("SwapTotal") ?? 0;
  const swapFreeBytes = values.get("SwapFree") ?? 0;
  return {
    totalBytes,
    availableBytes,
    freeBytes,
    usedBytes: Math.max(0, totalBytes - availableBytes),
    swapTotalBytes,
    swapFreeBytes,
    swapUsedBytes: Math.max(0, swapTotalBytes - swapFreeBytes),
  };
}

async function processDetails(processInfo: RawProcess): Promise<{
  command: string;
  threadCount: number | null;
}> {
  const root = `/proc/${processInfo.pid}`;
  const [commandLine, status] = await Promise.all([
    readOptionalProcessFile(`${root}/cmdline`),
    readOptionalProcessFile(`${root}/status`),
  ]);
  const command = commandLine.replace(/\0/g, " ").trim();
  const threads = /^Threads:\s+(\d+)$/m.exec(status);
  return {
    command: command || processInfo.name,
    threadCount: threads ? Number(threads[1]) : null,
  };
}

export async function inspectProcess(pidValue: number): Promise<ProcessInfo> {
  const pid = validPid(pidValue);
  const raw = await runC<RawProcess>(["inspect", String(pid)]);
  const memoryInfo = parseMemInfo(await readLinuxFile("/proc/meminfo"));
  return {
    ...sampleProcess(raw),
    ...await processDetails(raw),
    memoryPercent: memoryInfo.totalBytes > 0 ? (raw.memoryBytes / memoryInfo.totalBytes) * 100 : null,
  };
}

export async function processResources(pidValue: number) {
  const processInfo = await inspectProcess(pidValue);
  return {
    pid: processInfo.pid,
    name: processInfo.name,
    state: processInfo.stateLabel,
    cpuPercent: processInfo.cpuPercent,
    memoryBytes: processInfo.memoryBytes,
    userTimeNs: processInfo.userTimeNs,
    systemTimeNs: processInfo.systemTimeNs,
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

export function readCpuTicks(contents: string): Map<string, CpuTicks> {
  const result = new Map<string, CpuTicks>();
  for (const line of contents.split("\n")) {
    const match = /^(cpu(?:\d+)?)\s+(.+)$/.exec(line);
    if (!match) continue;
    const values = match[2].trim().split(/\s+/).map(Number);
    if (values.length < 4 || values.some((value) => !Number.isFinite(value))) continue;
    result.set(match[1], {
      total: values.slice(0, 8).reduce((total, value) => total + value, 0),
      idle: values[3] + (values[4] ?? 0),
    });
  }
  return result;
}

export function cpuPercent(current: CpuTicks | undefined, previous: CpuTicks | undefined): number | null {
  if (!current || !previous) return null;
  const totalDelta = current.total - previous.total;
  const idleDelta = current.idle - previous.idle;
  return totalDelta > 0
    ? Math.max(0, Math.min(100, ((totalDelta - idleDelta) / totalDelta) * 100))
    : null;
}

export function readDiskCounters(contents: string): DiskCounters {
  let readBytes = 0;
  let writeBytes = 0;
  for (const line of contents.split("\n")) {
    const fields = line.trim().split(/\s+/);
    if (fields.length < 10) continue;
    const [major, minor, name] = fields;
    if (/^(loop|ram|zram|dm-)/.test(name) || existsSync(`/sys/dev/block/${major}:${minor}/partition`)) continue;
    const sectorsRead = Number(fields[5]);
    const sectorsWritten = Number(fields[9]);
    if (Number.isFinite(sectorsRead)) readBytes += sectorsRead * 512;
    if (Number.isFinite(sectorsWritten)) writeBytes += sectorsWritten * 512;
  }
  return { readBytes, writeBytes };
}

export function readNetworkCounters(contents: string): NetworkCounters {
  let receivedBytes = 0;
  let sentBytes = 0;
  for (const line of contents.split("\n").slice(2)) {
    const divider = line.indexOf(":");
    if (divider < 0 || line.slice(0, divider).trim() === "lo") continue;
    const values = line.slice(divider + 1).trim().split(/\s+/).map(Number);
    if (values.length < 9) continue;
    if (Number.isFinite(values[0])) receivedBytes += values[0];
    if (Number.isFinite(values[8])) sentBytes += values[8];
  }
  return { receivedBytes, sentBytes };
}

export function rate(current: number, previous: number | undefined, elapsedMs: number): number | null {
  if (previous === undefined || elapsedMs <= 0) return null;
  return Math.max(0, current - previous) / (elapsedMs / 1000);
}

export async function systemResources(): Promise<SystemResources> {
  const [cpuContents, memoryContents, diskContents, networkContents, procEntries, filesystem] = await Promise.all([
    readLinuxFile("/proc/stat"),
    readLinuxFile("/proc/meminfo"),
    readLinuxFile("/proc/diskstats"),
    readLinuxFile("/proc/net/dev"),
    readdir("/proc"),
    statfs("/"),
  ]);
  const now = Date.now();
  const cpu = readCpuTicks(cpuContents);
  const disk = readDiskCounters(diskContents);
  const network = readNetworkCounters(networkContents);
  const memory = parseMemInfo(memoryContents);
  const previous = resourceSample;
  const elapsed = previous ? now - previous.at : 0;
  const totalCpu = cpuPercent(cpu.get("cpu"), previous?.cpu.get("cpu"));
  const diskReadRate = rate(disk.readBytes, previous?.disk.readBytes, elapsed);
  const diskWriteRate = rate(disk.writeBytes, previous?.disk.writeBytes, elapsed);
  const networkReceivedRate = rate(network.receivedBytes, previous?.network.receivedBytes, elapsed);
  const networkSentRate = rate(network.sentBytes, previous?.network.sentBytes, elapsed);
  const blockSize = Number(filesystem.bsize);
  const diskTotalBytes = Number(filesystem.blocks) * blockSize;
  const diskUsedBytes = Math.max(0, Number(filesystem.blocks - filesystem.bfree) * blockSize);
  const diskAvailableBytes = Number(filesystem.bavail) * blockSize;

  resourceSample = { at: now, cpu, disk, network };
  return {
    processCount: procEntries.filter((entry) => /^\d+$/.test(entry)).length,
    cpuPercent: totalCpu,
    cpuCores: [...cpu.entries()]
      .filter(([name]) => /^cpu\d+$/.test(name))
      .map(([name, current]) => ({
        name,
        cpuPercent: cpuPercent(current, previous?.cpu.get(name)),
      })),
    memoryTotalBytes: memory.totalBytes,
    memoryUsedBytes: memory.usedBytes,
    memoryAvailableBytes: memory.availableBytes,
    memoryFreeBytes: memory.freeBytes,
    memoryPercent: memory.totalBytes > 0 ? (memory.usedBytes / memory.totalBytes) * 100 : null,
    swapTotalBytes: memory.swapTotalBytes,
    swapUsedBytes: memory.swapUsedBytes,
    swapFreeBytes: memory.swapFreeBytes,
    swapPercent: memory.swapTotalBytes > 0 ? (memory.swapUsedBytes / memory.swapTotalBytes) * 100 : null,
    diskTotalBytes,
    diskUsedBytes,
    diskAvailableBytes,
    diskReadBytesPerSecond: diskReadRate,
    diskWriteBytesPerSecond: diskWriteRate,
    networkReceivedBytesPerSecond: networkReceivedRate,
    networkSentBytesPerSecond: networkSentRate,
    loadAverage: loadavg(),
    backend: "connected",
    system: "Linux / WSL",
    updatedAt: new Date(now).toISOString(),
  };
}

const PROCESS_ACTIONS = ["stop", "continue", "terminate", "kill"] as const;
export type ProcessAction = (typeof PROCESS_ACTIONS)[number];

export function validateControlAction(action: string): ProcessAction {
  if (!PROCESS_ACTIONS.includes(action as ProcessAction)) throw new ServiceError("Unsupported process action.");
  return action as ProcessAction;
}

export async function controlProcess(pidValue: number, action: string) {
  const pid = validPid(pidValue);
  const validated = validateControlAction(action);
  const result = await runC<{ success: boolean; pid: number; action: string; state: string; stateLabel: string }>(["control", String(pid), validated]);
  if (validated === "terminate" || validated === "kill") createdPids.delete(pid);
  return result;
}

async function rememberCreatedProcess(pid: number): Promise<void> {
  const identity = await runC<{ startTimeTicks: number }>(["inspect", String(pid)]);
  createdPids.set(pid, identity.startTimeTicks);
}

export type LaunchRequest =
  | { kind: "file"; filename: string }
  | { kind: "command"; command: "sleep" | "yes"; duration: number };

export function validateLaunchRequest(command: unknown, filename: unknown, durationValue: unknown): LaunchRequest {
  if (typeof filename === "string") {
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(filename)) throw new ServiceError("Use a simple file name without a directory path.");
    return { kind: "file", filename };
  }
  if (command !== "sleep" && command !== "yes") throw new ServiceError("Allowed launch commands are `sleep <seconds>` and `yes`.");
  const duration = durationValue === undefined ? 60 : Number(durationValue);
  if (command === "sleep" && (!Number.isInteger(duration) || duration < 1 || duration > 3600)) {
    throw new ServiceError("sleep duration must be between 1 and 3600 seconds.");
  }
  return { kind: "command", command, duration };
}

export async function createProcess(command: unknown, filename: unknown, durationValue: unknown) {
  const launch = validateLaunchRequest(command, filename, durationValue);
  if (launch.kind === "file") {
    const created = await runC<{ pid: number; file: string }>(["create-file", launch.filename]);
    await rememberCreatedProcess(created.pid);
    return { ...created, kind: "file" as const };
  }
  const args = launch.command === "sleep" ? [String(launch.duration)] : [];
  const created = await runC<{ pid: number; command: string }>(["launch", String(launch.command), ...args]);
  await rememberCreatedProcess(created.pid);
  if (launch.command === "yes") {
    setTimeout(() => { void controlProcess(created.pid, "terminate").catch(() => undefined); }, 20_000).unref();
  }
  return { ...created, kind: "command" as const };
}

export async function getPriority(pidValue: number) {
  return runC<{ pid: number; priority: number }>(["priority", String(validPid(pidValue))]);
}

export function validatePriorityDelta(delta: number): number {
  if (delta !== -1 && delta !== 1) throw new ServiceError("Priority adjustment must be -1 or 1.");
  return delta;
}

export async function adjustPriority(pidValue: number, delta: number) {
  return runC<{ pid: number; priority: number }>(["priority", String(validPid(pidValue)), String(validatePriorityDelta(delta))]);
}

export type SchedulingPolicy = "normal" | "batch" | "idle";
export type SettableSchedulingPolicy = "normal" | "batch";

export function validateSchedulingPolicy(policy: unknown): SettableSchedulingPolicy {
  if (policy !== "normal" && policy !== "batch") {
    throw new ServiceError("Choose the normal or batch scheduling policy.");
  }
  return policy;
}

export async function getScheduling(pidValue: number) {
  return runC<{ pid: number; policy: SchedulingPolicy | "other"; policyLabel: string }>(
    ["scheduling", String(validPid(pidValue))],
  );
}

export async function setScheduling(pidValue: number, policy: unknown) {
  return runC<{ pid: number; policy: SchedulingPolicy | "other"; policyLabel: string }>(
    ["scheduling", String(validPid(pidValue)), validateSchedulingPolicy(policy)],
  );
}

function rememberLifecycleEvent(event: LifecycleEvent): void {
  lifecycleEvents.push(event);
  if (lifecycleEvents.length > 500) lifecycleEvents.splice(0, lifecycleEvents.length - 500);
}

export function validateLifecycleDuration(duration: number): number {
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new ServiceError("Logging duration must be between 1 and 3600 seconds.");
  return duration;
}

export function startLifecycle(duration: number) {
  const validated = validateLifecycleDuration(duration);
  if (lifecycleRunning) throw new ServiceError("The lifecycle logger is already running.", 409);
  assertExecutable();
  lifecycleRunning = true;
  const child = spawn(executable, ["--api", "lifecycle", String(validated)], { cwd: cWorkingDirectory, shell: false, stdio: ["ignore", "pipe", "ignore"] });
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

export function validateWatchdogRequest(threshold: number, duration: number) {
  if (!Number.isFinite(threshold) || threshold < 0 || threshold > 100) throw new ServiceError("CPU threshold must be between 0 and 100 percent.");
  if (!Number.isInteger(duration) || duration < 1 || duration > 3600) throw new ServiceError("Monitoring duration must be between 1 and 3600 seconds.");
  return { threshold, duration };
}

export async function startWatchdog(pidValue: number, threshold: number, duration: number) {
  const pid = validPid(pidValue);
  const validated = validateWatchdogRequest(threshold, duration);
  const initial = await processResources(pid);
  const id = crypto.randomUUID();
  const job: WatchdogJob = {
    id, pid, threshold: validated.threshold, duration: validated.duration, elapsed: 0, running: true, status: "normal",
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
    if (job.elapsed >= validated.duration) {
      if (job.status !== "high" && job.status !== "warning" && job.status !== "exited") job.status = "complete";
      job.running = false;
      clearInterval(job.timer);
    }
  }, 1000);
  job.timer.unref();
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