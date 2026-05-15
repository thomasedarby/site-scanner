import Fastify, { type FastifyServerOptions } from "fastify";
import { readFile } from "node:fs/promises";
import path from "node:path";

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

  app.get("/health", async () => {
    return {
      status: "ok"
    };
  });

  app.get("/", async (request, reply) => {
    const html = await readFile(path.join(frontendDir, "index.html"), "utf-8");
    reply.type("text/html; charset=utf-8");
    return html;
  });

  app.get("/styles.css", async (request, reply) => {
    const css = await readFile(path.join(frontendDir, "styles.css"), "utf-8");
    reply.type("text/css; charset=utf-8");
    return css;
  });

  app.get("/app.js", async (request, reply) => {
    const js = await readFile(path.join(frontendDir, "app.js"), "utf-8");
    reply.type("application/javascript; charset=utf-8");
    return js;
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
