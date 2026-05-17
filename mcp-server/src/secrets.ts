import { readFileSync } from "node:fs";
import { join } from "node:path";

export function secretFromEnv(name: string): string | undefined {
  const credential = secretFromCredentialDirectory(name);
  if (credential) {
    return credential;
  }
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function secretFromCredentialDirectory(name: string): string | undefined {
  const dir = process.env.CREDENTIALS_DIRECTORY;
  if (!dir) {
    return undefined;
  }
  try {
    const value = readFileSync(join(dir, name), "utf8").trim();
    return value.length > 0 ? value : undefined;
  } catch {
    return undefined;
  }
}
