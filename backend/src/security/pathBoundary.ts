export function normalisePathBoundary(rawPathBoundary: string): string {
  const trimmedValue = rawPathBoundary.trim();

  if (trimmedValue.length === 0) {
    throw new Error("pathBoundary must not be empty");
  }

  if (/\s/.test(trimmedValue)) {
    throw new Error("pathBoundary must not contain whitespace");
  }

  if (
    trimmedValue.includes("://") ||
    trimmedValue.includes("?") ||
    trimmedValue.includes("#") ||
    trimmedValue.startsWith("//")
  ) {
    throw new Error("pathBoundary must be a path only");
  }

  if (!trimmedValue.startsWith("/")) {
    throw new Error("pathBoundary must start with /");
  }

  const normalizedPathname = new URL(trimmedValue, "https://boundary.example").pathname;

  if (normalizedPathname === "/") {
    return "/";
  }

  const withoutTrailingSlashes = normalizedPathname.replace(/\/+$/, "");

  return `${withoutTrailingSlashes}/`;
}

export function isPathWithinBoundary(candidatePath: string, boundary: string): boolean {
  const normalizedBoundary = normalisePathBoundary(boundary);
  const normalizedCandidatePath = new URL(candidatePath, "https://boundary.example").pathname;

  if (normalizedBoundary === "/") {
    return true;
  }

  const boundaryWithoutTrailingSlash = normalizedBoundary.slice(0, -1);

  return normalizedCandidatePath === boundaryWithoutTrailingSlash ||
    normalizedCandidatePath === normalizedBoundary ||
    normalizedCandidatePath.startsWith(normalizedBoundary);
}

export function derivePathBoundaryFromUrlPath(urlPathname: string): string | null {
  const normalizedPathname = new URL(urlPathname, "https://boundary.example").pathname;

  if (normalizedPathname === "/" || normalizedPathname.length === 0) {
    return null;
  }

  return normalisePathBoundary(normalizedPathname);
}
