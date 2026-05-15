import Fastify, { type FastifyServerOptions } from "fastify";
import path from "node:path";
import fastifyStatic from "@fastify/static";

import { loadScannerConfig, type LoadedScannerConfig } from "./config/scannerConfig.js";
import { registerScanRoutes } from "./routes/scans.js";
import { RealScanService, type ScanService } from "./services/scanService.js";

export interface AppDependencies {
  loadScannerConfig?: () => LoadedScannerConfig;
  scanService?: ScanService;
}

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {}
) {
  const app = Fastify(options);
  const frontendDir = path.resolve(process.cwd(), "..", "frontend");
  const scannerConfigLoader = dependencies.loadScannerConfig ?? (() => loadScannerConfig());
  const scanService = dependencies.scanService ?? new RealScanService();

  void app.register(fastifyStatic, {
    index: ["index.html"],
    prefix: "/",
    root: frontendDir
  });

  app.get("/health", async () => {
    return {
      status: "ok"
    };
  });

  if (scanService.initialize) {
    app.addHook("onReady", async () => {
      await scanService.initialize!();
    });
  }

  if (scanService.close) {
    app.addHook("onClose", async () => {
      await scanService.close!();
    });
  }

  void registerScanRoutes(app, {
    loadScannerConfig: scannerConfigLoader,
    scanService
  });

  return app;
}
