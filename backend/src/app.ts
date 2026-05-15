import Fastify, { type FastifyServerOptions } from "fastify";

import { loadScannerConfig, type LoadedScannerConfig } from "./config/scannerConfig.js";
import { registerScanRoutes } from "./routes/scans.js";
import { MockScanService } from "./services/mockScanService.js";

export interface AppDependencies {
  loadScannerConfig?: () => LoadedScannerConfig;
  scanService?: MockScanService;
}

export function buildApp(
  options: FastifyServerOptions = {},
  dependencies: AppDependencies = {}
) {
  const app = Fastify(options);
  const scannerConfigLoader = dependencies.loadScannerConfig ?? (() => loadScannerConfig());
  const scanService = dependencies.scanService ?? new MockScanService();

  app.get("/health", async () => {
    return {
      status: "ok"
    };
  });

  void registerScanRoutes(app, {
    loadScannerConfig: scannerConfigLoader,
    scanService
  });

  return app;
}
