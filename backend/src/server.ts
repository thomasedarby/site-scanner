import { buildApp } from "./app.js";
import { loadScannerConfig } from "./config/scannerConfig.js";

const host = process.env.HOST ?? "0.0.0.0";
const port = Number(process.env.PORT ?? "8080");

const app = buildApp({
  logger: true
});

try {
  const scannerConfig = loadScannerConfig();

  app.log.info(
    {
      configPath: scannerConfig.configPath,
      allowedDomainsCount: scannerConfig.allowedDomains.length,
      scanCreationAllowed: scannerConfig.scanCreationAllowed
    },
    "Scanner config loaded"
  );

  await app.listen({ host, port });
} catch (error) {
  app.log.error(error);
  process.exit(1);
}
