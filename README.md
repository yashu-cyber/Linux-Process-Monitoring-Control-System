# Linux Process Monitoring and Control System

A React interface around the existing Linux C process monitor. The C program remains the OS-facing layer: it reads `/proc`, forks and execs permitted child processes, sends Linux signals, reads and changes nice values, and records lifecycle events. Express validates requests and bridges the browser to the compiled C executable.

## Architecture

```text
Windows browser (or Linux browser)
          |
          | HTTP / JSON, localhost:5173
          v
React + TypeScript + Vite + Tailwind + Recharts
          |
          | Vite development proxy: /api -> 127.0.0.1:3001
          v
Node.js + Express (run inside Ubuntu / WSL)
          |
          | spawn(ELF executable, fixed argument arrays; shell disabled)
          v
process_monitor.c --api <operation>
          |
          v
Linux kernel, /proc, fork/exec, signals, nice values
```

The C program's original interactive menu remains the default when it is run without `--api`. The web server invokes that same program with a small JSON mode. The browser cannot execute operating-system commands. The API does not accept arbitrary shell strings: launch is restricted to `sleep` with a validated duration and `yes` (automatically terminated after 20 seconds). File creation accepts a simple filename and uses exclusive creation, so an existing file is not overwritten.

## Project Structure

```text
.
├── process_monitor.c                 Existing C implementation and opt-in JSON mode
├── c_backend/
│   └── Makefile                      Builds the C executable from the root source
├── backend/
│   ├── src/server.ts                 Express API routes and shutdown
│   ├── src/processMonitorService.ts  Validated C process bridge and live services
│   ├── smoke-test.mjs                HTTP integration smoke tests
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/App.tsx                   All 12 application features
│   ├── src/main.tsx
│   ├── src/styles.css
│   ├── index.html
│   ├── vite.config.ts                Development API proxy
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── package.json
│   └── tsconfig.json
└── README.md
```

The C executable is generated at `c_backend/process_monitor`. Runtime lifecycle records are appended to `process_events.log` in the project root. These generated files and dependency/build directories are excluded by `.gitignore`.

## Requirements

- Ubuntu on WSL 2 (or another Linux distribution with `/proc`)
- GCC and Make (`build-essential`)
- Node.js 18 or newer and npm
- Windows Chrome, Edge, or another browser when using WSL

The C executable is a Linux ELF binary. Compile and run the Node API inside Linux/WSL; a Windows Node process cannot spawn that ELF binary. The frontend can run in WSL or Windows. The steps below run both servers in WSL and open the page in a Windows browser.

## Install

Open Ubuntu from Windows Terminal or VS Code's WSL terminal:

```bash
sudo apt update
sudo apt install -y build-essential nodejs npm
gcc --version
node --version
npm --version
```

Build the existing C source:

```bash
cd "/mnt/d/3Linux-Process-Monitoring-and-Control-System - Copy"
make -C c_backend
```

This compiles `process_monitor.c` with GCC and leaves the original C source intact. To use the original terminal menu at any time:

```bash
./c_backend/process_monitor
```

## Run the Website

Use two Ubuntu/WSL terminals from the project root.

Terminal 1, API and C bridge:

```bash
cd "/mnt/d/3Linux-Process-Monitoring-and-Control-System - Copy/backend"
npm install
npm run dev
```

The API listens on `127.0.0.1:3001`. Keep this terminal running.

Terminal 2, React frontend:

```bash
cd "/mnt/d/3Linux-Process-Monitoring-and-Control-System - Copy/frontend"
npm install
npm run dev
```

Open **http://localhost:5173** in Windows Chrome, Edge, or Brave. Vite forwards `/api` requests to the backend in WSL. WSL 2 localhost forwarding is enabled by default on current Windows installations.

If Windows cannot reach the WSL servers through `localhost`, check that WSL 2 is current and localhost forwarding is enabled in `%UserProfile%\.wslconfig`:

```ini
[wsl2]
localhostForwarding=true
```

Then run `wsl --shutdown`, reopen Ubuntu, and start both servers again. Keep the API bound to its default loopback address; do not expose this process-control API to an untrusted network.

## Build and Test

Build the C executable:

```bash
make -C c_backend
```

Build/type-check the backend:

```bash
cd backend
npm install
npm run build
```

Build/type-check the frontend:

```bash
cd frontend
npm install
npm run build
```

With the API running, execute the integration smoke tests from another terminal:

```bash
cd backend
npm run test:smoke
```

The smoke tests use real Linux processes, exercise process signals and resource counters, check the lifecycle log and watchdog, reject unsafe inputs, and clean up the test processes and temporary file.

## API

All endpoints are served from `http://localhost:3001/api`:

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/system/status` | Linux process count, CPU ticks, memory totals, and backend status |
| `GET` | `/processes` | Live `/proc` process list |
| `GET` | `/processes/created` | Still-running processes launched by this API session |
| `GET` | `/processes/:pid` | Process name, path, PID/PPID, state, owner, memory, CPU-time counters |
| `GET` | `/processes/:pid/resources` | Current CPU sample, RSS, user time, and system time |
| `POST` | `/processes/:pid/control` | `stop`, `continue`, `terminate`, or `kill` action |
| `POST` | `/processes/create` | Allowlisted `sleep`/`yes` launch or safe file-creation process |
| `GET` | `/process-tree` | Live PID/PPID rows for the process tree |
| `GET` | `/processes/:pid/priority` | Current Linux nice value |
| `POST` | `/processes/:pid/priority` | Change the nice value by one step (`delta: -1` or `1`) |
| `POST` | `/watchdog` | Start a PID/CPU-threshold/duration watchdog |
| `GET` | `/watchdog/:id` | Current watchdog status and latest measured values |
| `POST` | `/watchdog/:id/stop` | Stop a watchdog |
| `POST` | `/lifecycle/start` | Start the C lifecycle snapshot logger for a bounded duration |
| `GET` | `/lifecycle/events` | Read saved `process_events.log` and live events |
| `POST` | `/application/refresh` | Refresh process rows and system counters |
| `POST` | `/application/exit` | Stop the API and send SIGTERM to processes created by this session |

Process-control actions from the website require confirmation. Invalid inputs return structured JSON errors with appropriate HTTP status codes; stack traces are not sent to the browser.

## C Integration

The terminal application is unchanged as the default. The additive `--api` mode accepts fixed operations and emits JSON on standard output, for example:

```bash
./c_backend/process_monitor --api metrics
./c_backend/process_monitor --api list
./c_backend/process_monitor --api inspect 1
./c_backend/process_monitor --api priority 1
./c_backend/process_monitor --api control 1234 stop
./c_backend/process_monitor --api launch sleep 30
./c_backend/process_monitor --api create-file demo-output.txt
./c_backend/process_monitor --api lifecycle 10
./c_backend/process_monitor --api events
```

The Node service uses `child_process.spawn` with an argument array and `shell: false`; it never forwards browser-provided shell text. The C layer owns `/proc` reads, `fork`/`exec`, file creation, signal delivery, nice-value operations, and lifecycle snapshots. Node computes interval CPU percentages from successive C CPU-time counters, manages bounded sampling/watchdog sessions, and serves the React API. Lifecycle logging continues to append to the original `process_events.log` in the project root.

## Demonstrating the 12 Features

1. **Process Dashboard:** open the homepage; the process table refreshes every 1.5 seconds and shows actual PIDs from `/proc`; use search, filter, sort, paginate, and select.
2. **Process Inspector:** select a table row or enter its PID to view its `/proc` identity, parent, executable, state, owner, memory, and CPU times.
3. **Process Control:** enter/select a PID and send STOP, CONTINUE, TERMINATE, or KILL; confirm before every signal.
4. **Process Creation & Launch:** launch `sleep` (1–3600 seconds) or `yes` (auto-terminated after 20 seconds), or create a new file with a separate C child process.
5. **Live Process Monitoring:** select a PID and duration to sample status, CPU, and memory at one-second intervals.
6. **Process Tree:** expand real parent/child relationships; search PIDs/names, select a process, and zoom the view.
7. **Resource Monitor:** chart live CPU, resident memory, user CPU time, and system CPU time for a PID.
8. **Priority & Scheduling:** read the nice value and request a one-step increase/decrease; see the actual value read back or a permission error.
9. **Watchdog & Alerts:** set PID, CPU threshold, and duration; observe Normal, Warning, High, or process-exited state.
10. **Lifecycle / Event Logger:** start bounded C snapshot logging, observe STARTED/TERMINATED events, download CSV, clear the UI view, or refresh. The persisted C log is not deleted by clearing the UI.
11. **Refresh Dashboard:** select the sidebar or header refresh control to reload processes, host counters, created-process count, and last-update time.
12. **Exit:** select Exit Application and confirm. The Node backend shuts down and sends SIGTERM to app-created processes; the terminal C menu is a separate process and is not stopped.

## Cross-Interface Verification

Keep the API and frontend running as described above. In a third Ubuntu/WSL terminal, create a real Linux process:

```bash
sleep 300 &
PID=$!
echo "Test PID: $PID"
```

The website dashboard should show that PID within about two seconds. Use **Process Control** to stop and continue it; verify each transition in Ubuntu:

```bash
ps -o pid,state,comm -p "$PID"
```

State `T` means stopped. After Continue, the process should return to a non-`T` state (usually `S` for `sleep`). Use **Terminate** in the website and confirm that `ps -p "$PID"` returns no process.

For the reverse direction, create another fixture and signal it from Ubuntu:

```bash
sleep 300 &
PID=$!
kill -STOP "$PID"
ps -o pid,state,comm -p "$PID"
kill -CONT "$PID"
ps -o pid,state,comm -p "$PID"
kill "$PID"
```

The dashboard should show the stopped and resumed states on its next poll, and remove the process after it exits. The automated Linux smoke test exercises this same shared-kernel path with a child process spawned outside the C application registry:

```bash
cd "/mnt/d/3Linux-Process-Monitoring-and-Control-System - Copy/backend"
npm run test:smoke
```

## Screenshots

The dashboard is designed for a live demonstration. Open the running page at `http://localhost:5173` to capture the dashboard and feature views with real WSL process data.

## Troubleshooting

- **C executable missing:** from the project root run `make -C c_backend`; the service also supports `PROCESS_MONITOR_BIN` if the binary is stored elsewhere.
- **Node API reports disconnected:** start the backend from the `backend` directory in Ubuntu/WSL and check that port `3001` is available.
- **Frontend cannot reach the API:** use `http://localhost:5173`, keep both servers running in WSL, and confirm `localhostForwarding=true` for WSL 2.
- **Permission denied for a process:** Linux users can control or reprioritize only processes permitted by the kernel. Run the backend with appropriate privileges only when required; avoid running it as root for routine demonstrations.
- **Process no longer exists:** a process may terminate between table refresh and action. Refresh the dashboard and select a current PID.
- **File already exists:** the creation operation will not overwrite it; choose another simple filename.
- **Lifecycle events are missing:** the logger detects changes after its initial snapshot; start it before creating or ending the process you want to demonstrate.
- **Slow initial build on a Windows-mounted WSL directory:** run the project inside the WSL Linux filesystem for better file watching and build performance.

## Limitations

- CPU percentage is an interval sample and can be unavailable until a second sample arrives. Per-process values can exceed 100% when multiple CPU cores are used.
- Linux may restrict executable paths and process details for other users. Process names from `/proc/<pid>/comm` follow the kernel's short-name limit.
- The process tree is a current PID/PPID snapshot, not a kernel event stream; entries can change between refreshes.
- Watchdog and lifecycle sampling use one-second intervals, so very short-lived events between snapshots may not be observed.
- The API process-ownership list is in memory. It tracks processes created in the current backend session; shutdown cleans up that session's tracked processes.
- The web launch allowlist is deliberately small. Add new programs as explicit C API operations with validation rather than enabling general shell execution.