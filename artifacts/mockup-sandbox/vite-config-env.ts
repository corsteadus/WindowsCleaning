const DEFAULT_BUILD_PORT = 5173;
const DEFAULT_BUILD_BASE_PATH = "/";

type ViteCommand = "build" | "serve" | string;

/**
 * Resolve the values used by Vite's server/preview configuration.
 *
 * A production build does not start a server, so it must not depend on the
 * workflow-injected runtime port or base path. Development and preview keep
 * the existing strict behavior so a misconfigured workflow fails clearly.
 */
export function resolveVitePort(
  rawPort: string | undefined,
  command: ViteCommand,
): number {
  if (!rawPort) {
    if (command === "build") return DEFAULT_BUILD_PORT;
    throw new Error(
      "PORT environment variable is required but was not provided.",
    );
  }

  const port = Number(rawPort);
  if (Number.isNaN(port) || port <= 0) {
    throw new Error(`Invalid PORT value: "${rawPort}"`);
  }
  return port;
}

export function resolveViteBasePath(
  rawBasePath: string | undefined,
  command: ViteCommand,
): string {
  if (!rawBasePath) {
    if (command === "build") return DEFAULT_BUILD_BASE_PATH;
    throw new Error(
      "BASE_PATH environment variable is required but was not provided.",
    );
  }
  return rawBasePath;
}