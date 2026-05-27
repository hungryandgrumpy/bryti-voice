// src/web-e2ee/path-utils.ts         
export interface WebE2EEPathUtilsOptions {
  pathPrefix: string;
}

export interface WebE2EEPathUtilsResult {
  normalizedPathPrefix: string;
  prefixedPath: string;
}

export function normalizePathPrefix(pathPrefix: string): string {
  if (!pathPrefix || pathPrefix === "/") {
    return "/";
  }

  let normalized = pathPrefix.trim();
  if (!normalized.startsWith("/")) {
    normalized = `/${normalized}`;
  }
  normalized = normalized.replace(/\/{2,}/g, "/");
  normalized = normalized.replace(/\/$/, "");
  return normalized || "/";
}

export function prefixedPath(pathPrefix: string, suffix: string): string {
  const prefix = normalizePathPrefix(pathPrefix);
  if (!suffix.startsWith("/")) {
    suffix = `/${suffix}`;
  }
  return prefix === "/" ? suffix : `${prefix}${suffix}`;
}

export function matchesIndexPath(pathname: string, pathPrefix: string): boolean {
  const prefix = normalizePathPrefix(pathPrefix);
  return pathname === prefix || (prefix !== "/" && pathname === `${prefix}/`);
}
