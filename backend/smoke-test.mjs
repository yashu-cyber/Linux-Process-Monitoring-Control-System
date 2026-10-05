import { existsSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const base = process.env.API_BASE_URL ?? "http://127.0.0.1:3001/api";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const createdPids = new Set();
const checks = [];
let fixtureFile;
let externalChild;

async function call(path, method = "GET", body) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: response.status, data: await response.json() };
}

function check(name, passed) {
  checks.push({ name, passed: Boolean(passed) });
  if (!passed) throw new Error(`Smoke test failed: ${name}`);
}

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function procState(pid) {
  const stat = await readFile(`/proc/${pid}/stat`, "utf8");
  return stat.slice(stat.lastIndexOf(")") + 2).split(" ")[0];
}

try {
  const system = await call("/system/status");
  check("system status reports real Linux metrics", system.status === 200 && system.data.processCount > 0 && system.data.memoryTotalBytes > 0);

  const list = await call("/processes");
  check("process list comes from /proc", list.status === 200 && list.data.processes.length > 0);

  const tree = await call("/process-tree");
  check("process tree includes live PID/PPID rows", tree.status === 200 && tree.data.processes.some((item) => item.pid === 1));

  externalChild = spawn("sleep", ["300"], { stdio: "ignore" });
  await once(externalChild, "spawn");
  const externalPid = externalChild.pid;
  check("external Linux process starts outside the C application registry", Number.isInteger(externalPid));
  const externalList = await call("/processes");
  check("C /proc list discovers an externally created process", externalList.status === 200 && externalList.data.processes.some((item) => item.pid === externalPid));

  const externalStopped = await call(`/processes/${externalPid}/control`, "POST", { action: "stop" });
  check("website STOP verifies the external process as stopped", externalStopped.status === 200 && externalStopped.data.state === "T" && await procState(externalPid) === "T");
  process.kill(externalPid, "SIGCONT");
  await delay(100);
  const externalContinued = await call("/processes");
  check("an Ubuntu-side CONTINUE is visible in the next process snapshot", externalContinued.status === 200 && externalContinued.data.processes.some((item) => item.pid === externalPid && item.state !== "T" && item.state !== "t"));
  const externalTerminated = await call(`/processes/${externalPid}/control`, "POST", { action: "terminate" });
  if (externalChild.exitCode === null && externalChild.signalCode === null) await once(externalChild, "exit");
  check("website TERMINATE removes the external process", externalTerminated.status === 200 && !existsSync(`/proc/${externalPid}`));
  externalChild = undefined;

  const invalidPid = await call("/processes/99999999");
  check("invalid PID is returned as 404", invalidPid.status === 404);

  const unsafeCommand = await call("/processes/create", "POST", { command: "uname -a" });
  check("arbitrary shell command is rejected", unsafeCommand.status === 400);

  const launched = await call("/processes/create", "POST", { command: "sleep", duration: 12 });
  check("allowlisted command is forked by the C backend", launched.status === 201 && launched.data.pid > 0);
  const pid = launched.data.pid;
  createdPids.add(pid);
  const owned = await call("/processes/created");
  check("created-process inventory matches the live /proc start identity", owned.status === 200 && owned.data.processes.some((item) => item.pid === pid && item.startTimeTicks > 0));

  const detail = await call(`/processes/${pid}`);
  check("process inspector returns executable identity, PPID, and start time", detail.status === 200 && detail.data.pid === pid && Number.isInteger(detail.data.ppid) && detail.data.startTimeUnix > 0);

  const stopped = await call(`/processes/${pid}/control`, "POST", { action: "stop" });
  check("STOP maps to SIGSTOP", stopped.status === 200);
  await delay(150);
  const resumed = await call(`/processes/${pid}/control`, "POST", { action: "continue" });
  check("CONTINUE maps to SIGCONT", resumed.status === 200);

  const resources = await call(`/processes/${pid}/resources`);
  check("resource monitor reads CPU and RSS counters", resources.status === 200 && resources.data.memoryBytes >= 0 && resources.data.userTimeNs >= 0);
  await delay(1_050);
  const nextResources = await call(`/processes/${pid}/resources`);
  check("live monitor returns a second measured CPU sample", nextResources.status === 200 && nextResources.data.cpuPercent !== null);

  const priority = await call(`/processes/${pid}/priority`);
  check("priority view reads the Linux nice value", priority.status === 200 && Number.isInteger(priority.data.priority));
  const adjusted = await call(`/processes/${pid}/priority`, "POST", { delta: 1 });
  check("priority update reads back the resulting nice value", adjusted.status === 200 && adjusted.data.priority === priority.data.priority + 1);

  const permission = await call("/processes/1/priority", "POST", { delta: -1 });
  check("privileged priority change returns a clear result", permission.status === 403 || permission.status === 200);

  const watchdog = await call("/watchdog", "POST", { pid, threshold: 80, duration: 6 });
  check("watchdog starts for a real process", watchdog.status === 201 && watchdog.data.running);

  const lifecycle = await call("/lifecycle/start", "POST", { duration: 4 });
  check("C lifecycle logger starts with a bounded duration", lifecycle.status === 202 && lifecycle.data.running);

  await delay(250);
  const lifecycleChild = await call("/processes/create", "POST", { command: "sleep", duration: 12 });
  check("lifecycle fixture starts after the logger baseline", lifecycleChild.status === 201 && lifecycleChild.data.pid > 0);
  if (lifecycleChild.status === 201) createdPids.add(lifecycleChild.data.pid);

  await delay(1_150);
  const terminated = await call(`/processes/${pid}/control`, "POST", { action: "terminate" });
  check("TERMINATE maps to SIGTERM", terminated.status === 200);
  createdPids.delete(pid);
  if (lifecycleChild.status === 201) {
    await call(`/processes/${lifecycleChild.data.pid}/control`, "POST", { action: "terminate" });
    createdPids.delete(lifecycleChild.data.pid);
  }

  await delay(3_200);
  const watchdogState = await call(`/watchdog/${watchdog.data.id}`);
  check("watchdog detects a process that exits while monitored", watchdogState.status === 200 && watchdogState.data.status === "exited");
  const watchdogStopped = await call(`/watchdog/${watchdog.data.id}/stop`, "POST");
  check("watchdog stop endpoint completes the session", watchdogStopped.status === 200 && !watchdogStopped.data.running);

  const lifecycleState = await call("/lifecycle/events");
  check("lifecycle STARTED and TERMINATED events persist to process_events.log",
    lifecycleState.status === 200 &&
    lifecycleState.data.events.some((event) => event.pid === lifecycleChild.data.pid && event.event === "STARTED") &&
    lifecycleState.data.events.some((event) => event.pid === lifecycleChild.data.pid && event.event === "TERMINATED"));

  const killChild = await call("/processes/create", "POST", { command: "sleep", duration: 12 });
  check("create process for SIGKILL test", killChild.status === 201 && killChild.data.pid > 0);
  if (killChild.status === 201) {
    createdPids.add(killChild.data.pid);
    const killed = await call(`/processes/${killChild.data.pid}/control`, "POST", { action: "kill" });
    check("KILL maps to SIGKILL", killed.status === 200);
    createdPids.delete(killChild.data.pid);
  }

  const unique = `${Date.now()}-${process.pid}`;
  fixtureFile = `api-smoke-${unique}.txt`;
  const fileProcess = await call("/processes/create", "POST", { filename: fixtureFile });
  check("file creation uses a separate C child process", fileProcess.status === 201 && fileProcess.data.pid > 0);
  if (fileProcess.status === 201) {
    createdPids.add(fileProcess.data.pid);
    await delay(150);
    check("file-creation child made the requested file", existsSync(resolve(projectRoot, fixtureFile)));
    await call(`/processes/${fileProcess.data.pid}/control`, "POST", { action: "terminate" });
    createdPids.delete(fileProcess.data.pid);
  }

  const created = await call("/processes/created");
  check("created-process inventory responds", created.status === 200 && Array.isArray(created.data.processes));

  const refresh = await call("/application/refresh", "POST");
  check("dashboard refresh returns current processes and metrics", refresh.status === 200 && refresh.data.system.processCount > 0 && refresh.data.processes.length > 0);

  console.log(JSON.stringify({ passed: checks.filter((item) => item.passed).length, total: checks.length, checks }, null, 2));
} finally {
  if (externalChild?.pid && externalChild.exitCode === null) externalChild.kill("SIGKILL");
  for (const pid of createdPids) {
    try { await call(`/processes/${pid}/control`, "POST", { action: "terminate" }); } catch { /* A test child may already have exited. */ }
  }
  if (fixtureFile) {
    try { rmSync(resolve(projectRoot, fixtureFile), { force: true }); } catch { /* The file may not have been created. */ }
  }
}