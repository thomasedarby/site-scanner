const SKIPPED_PROTOCOLS = new Set([
  "mailto:",
  "tel:",
  "javascript:",
  "data:",
  "file:",
  "ftp:"
]);

const IPV4_PATTERN = /^\d{1,3}(?:\.\d{1,3}){3}$/;

export interface NormaliseUrlOptions {
  stripQueryString?: boolean;
}

function parseIpv4(hostname: string): number[] | null {
  if (!IPV4_PATTERN.test(hostname)) {
    return null;
  }

  const octets = hostname.split(".").map(Number);

  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function normaliseHostname(hostname: string): string {
  return hostname.toLowerCase().replace(/\.+$/, "");
}

export function normaliseUrl(
  inputUrl: string,
  baseUrl?: string,
  options: NormaliseUrlOptions = {}
): URL {
  const url = new URL(inputUrl, baseUrl);

  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error(`Unsupported URL protocol: ${url.protocol}`);
  }

  url.hash = "";

  if (options.stripQueryString ?? true) {
    url.search = "";
  }

  url.hostname = normaliseHostname(url.hostname);

  return url;
}

export function isAllowedDomain(url: URL | string, allowedDomains: string[]): boolean {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;
  const hostname = normaliseHostname(parsedUrl.hostname);

  return allowedDomains.some((allowedDomain) => normaliseHostname(allowedDomain) === hostname);
}

export function isPrivateOrLocalHostname(hostname: string): boolean {
  const normalisedHostname = normaliseHostname(hostname);

  if (normalisedHostname === "localhost" || normalisedHostname === "0.0.0.0") {
    return true;
  }

  const ipv4 = parseIpv4(normalisedHostname);

  if (!ipv4) {
    return false;
  }

  const [first, second, third, fourth] = ipv4;

  if (first === 127) {
    return true;
  }

  if (first === 10) {
    return true;
  }

  if (first === 172 && second >= 16 && second <= 31) {
    return true;
  }

  if (first === 192 && second === 168) {
    return true;
  }

  if (first === 169 && second === 254) {
    return true;
  }

  if (first === 169 && second === 254 && third === 169 && fourth === 254) {
    return true;
  }

  return false;
}

export function isSameOrigin(url: URL | string, origin: string): boolean {
  const parsedUrl = typeof url === "string" ? new URL(url) : url;

  return parsedUrl.origin === origin;
}

export function shouldSkipUrl(url: string): boolean {
  const trimmedUrl = url.trim();

  if (trimmedUrl.length === 0 || trimmedUrl.startsWith("#")) {
    return true;
  }

  const lowerTrimmedUrl = trimmedUrl.toLowerCase();

  for (const protocol of SKIPPED_PROTOCOLS) {
    if (lowerTrimmedUrl.startsWith(protocol)) {
      return true;
    }
  }

  try {
    const parsedUrl = new URL(trimmedUrl);

    return !["http:", "https:"].includes(parsedUrl.protocol);
  } catch {
    return false;
  }
}
