import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import {
  ServiceError,
  adjustPriority,
  controlProcess,
  createProcess,
  createdProcesses,
  getPriority,
  getWatchdog,
  inspectProcess,
  lifecycleState,
  listProcesses,
  processResources,
  refreshDashboard,
  shutdownApplication,
  startLifecycle,
  startWatchdog,
  systemStatus,
  stopWatchdog,
} from "./processMonitorService.js";

const app = express();
const port = Number(process.env.PORT ?? 3001);
app.use(cors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] }));
app.use(express.json({ limit: "16kb" }));

function asyncRoute(handler: (request: Request, response: Response) => Promise<unknown> | unknown) {
  return (request: Request, response: Response, next: NextFunction) => {
    Promise.resolve(handler(request, response)).catch(next);
  };
}

function numberParam(value: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new ServiceError("Enter a valid number.");
  return parsed;
}

function routeParam(value: string | string[] | undefined): string {
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
}

app.get("/api/system/status", asyncRoute(async (_request, response) => response.json(await systemStatus())));
app.get("/api/processes", asyncRoute(async (_request, response) => response.json({ processes: await listProcesses() })));
app.get("/api/processes/created", asyncRoute(async (_request, response) => response.json(await createdProcesses())));
app.get("/api/processes/:pid", asyncRoute(async (request, response) => response.json(await inspectProcess(numberParam(routeParam(request.params.pid))))));
app.get("/api/processes/:pid/resources", asyncRoute(async (request, response) => response.json(await processResources(numberParam(routeParam(request.params.pid))))));
app.post("/api/processes/:pid/control", asyncRoute(async (request, response) => {
  response.json(await controlProcess(numberParam(routeParam(request.params.pid)), request.body?.action));
}));
app.post("/api/processes/create", asyncRoute(async (request, response) => {
  response.status(201).json(await createProcess(request.body?.command, request.body?.filename, request.body?.duration));
}));
app.get("/api/process-tree", asyncRoute(async (_request, response) => response.json({ processes: await listProcesses() })));
app.get("/api/processes/:pid/priority", asyncRoute(async (request, response) => response.json(await getPriority(numberParam(routeParam(request.params.pid))))));
app.post("/api/processes/:pid/priority", asyncRoute(async (request, response) => {
  response.json(await adjustPriority(numberParam(routeParam(request.params.pid)), request.body?.delta));
}));
app.post("/api/watchdog", asyncRoute(async (request, response) => {
  response.status(201).json(await startWatchdog(Number(request.body?.pid), Number(request.body?.threshold), Number(request.body?.duration)));
}));
app.get("/api/watchdog/:id", asyncRoute(async (request, response) => response.json(getWatchdog(routeParam(request.params.id)))));
app.post("/api/watchdog/:id/stop", asyncRoute(async (request, response) => response.json(stopWatchdog(routeParam(request.params.id)))));
app.post("/api/lifecycle/start", asyncRoute(async (request, response) => response.status(202).json(startLifecycle(Number(request.body?.duration)))));
app.get("/api/lifecycle/events", asyncRoute(async (_request, response) => response.json(await lifecycleState())));
app.post("/api/application/refresh", asyncRoute(async (_request, response) => response.json(await refreshDashboard())));

app.post("/api/application/exit", asyncRoute(async (_request, response) => {
  const result = await shutdownApplication();
  response.json(result);
  setTimeout(() => server.close(() => process.exit(0)), 250).unref();
}));

app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
  const serviceError = error instanceof ServiceError ? error : undefined;
  if (!serviceError) console.error("API request failed:", error instanceof Error ? error.message : "unknown error");
  response.status(serviceError?.status ?? 500).json({
    success: false,
    error: serviceError?.message ?? "The backend could not complete this request.",
  });
});

const server = app.listen(port, process.env.HOST ?? "127.0.0.1", () => {
  console.log(`Linux process API listening on http://${process.env.HOST ?? "127.0.0.1"}:${port}`);
});