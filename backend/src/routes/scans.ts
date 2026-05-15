import type { FastifyInstance } from "fastify";

import type { LoadedScannerConfig } from "../config/scannerConfig.js";
import { isAllowedDomain, isPrivateOrLocalHostname, normaliseUrl, shouldSkipUrl } from "../security/urlSafety.js";
import { ScanExecutionError, type ScanService } from "../services/scanService.js";

export interface ScansRouteDependencies {
  loadScannerConfig: () => LoadedScannerConfig;
  scanService: ScanService;
}

function sendNotFound(reply: Parameters<FastifyInstance["get"]>[1] extends never ? never : any) {
  return reply.code(404).send({
    error: "Not Found",
    message: "Scan not found"
  });
}

function validateSubmittedUrl(rawUrl: unknown, scannerConfig: LoadedScannerConfig): URL {
  if (typeof rawUrl !== "string" || rawUrl.trim().length === 0) {
    throw new Error("url is required");
  }

  if (shouldSkipUrl(rawUrl)) {
    throw new Error("Submitted URL uses an unsupported or skipped protocol");
  }

  let normalizedUrl: URL;

  try {
    normalizedUrl = normaliseUrl(rawUrl, undefined, {
      stripQueryString: scannerConfig.stripQueryStrings
    });
  } catch (error) {
    throw new Error(error instanceof Error ? error.message : "Invalid URL");
  }

  if (isPrivateOrLocalHostname(normalizedUrl.hostname)) {
    throw new Error("Submitted URL hostname is private, local, or otherwise unsafe");
  }

  if (!isAllowedDomain(normalizedUrl, scannerConfig.allowedDomains)) {
    throw new Error("Submitted URL hostname is not in allowedDomains");
  }

  return normalizedUrl;
}

function validateMaxPages(rawMaxPages: unknown, scannerConfig: LoadedScannerConfig): number {
  if (rawMaxPages === undefined) {
    return scannerConfig.defaultMaxPages;
  }

  if (!Number.isInteger(rawMaxPages) || (rawMaxPages as number) < 1) {
    throw new Error("maxPages must be a positive integer");
  }

  if ((rawMaxPages as number) > scannerConfig.maxAllowedPages) {
    throw new Error(`maxPages must not exceed ${scannerConfig.maxAllowedPages}`);
  }

  return rawMaxPages as number;
}

export async function registerScanRoutes(
  app: FastifyInstance,
  dependencies: ScansRouteDependencies
) {
  app.post("/api/scans", async (request, reply) => {
    const scannerConfig = dependencies.loadScannerConfig();

    if (!scannerConfig.scanCreationAllowed) {
      return reply.code(400).send({
        error: "Invalid scanner configuration",
        message: "Scan creation is disabled until allowedDomains contains at least one approved hostname"
      });
    }

    const body = (request.body ?? {}) as { maxPages?: unknown; url?: unknown };

    try {
      const normalizedUrl = validateSubmittedUrl(body.url, scannerConfig);
      const maxPages = validateMaxPages(body.maxPages, scannerConfig);
      const scan = await dependencies.scanService.createScan({
        url: normalizedUrl.toString(),
        maxPages
      }, scannerConfig);

      return reply.code(201).send(scan);
    } catch (error) {
      if (error instanceof ScanExecutionError) {
        return reply.code(500).send({
          error: "Scan failed",
          message: error.message,
          scanId: error.scanId
        });
      }

      return reply.code(400).send({
        error: "Invalid scan request",
        message: error instanceof Error ? error.message : "Invalid scan request"
      });
    }
  });

  app.get("/api/scans", async () => {
    return {
      items: await dependencies.scanService.listScans()
    };
  });

  app.get("/api/scans/:id", async (request, reply) => {
    const scan = await dependencies.scanService.getScan((request.params as { id: string }).id);

    if (!scan) {
      return sendNotFound(reply);
    }

    return scan;
  });

  app.get("/api/scans/:id/pages.csv", async (request, reply) => {
    const csv = await dependencies.scanService.getPagesCsv((request.params as { id: string }).id);

    if (!csv) {
      return sendNotFound(reply);
    }

    reply.header("content-type", "text/csv; charset=utf-8");
    return csv;
  });

  app.get("/api/scans/:id/sitemap.mmd", async (request, reply) => {
    const sitemap = await dependencies.scanService.getSitemap((request.params as { id: string }).id);

    if (!sitemap) {
      return sendNotFound(reply);
    }

    reply.header("content-type", "text/plain; charset=utf-8");
    return sitemap;
  });

  app.get("/api/scans/:id/compare", async (request, reply) => {
    const comparison = await dependencies.scanService.compareScan((request.params as { id: string }).id);

    if (!comparison) {
      return sendNotFound(reply);
    }

    return comparison;
  });
}
