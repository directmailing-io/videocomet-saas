/**
 * Typed env-getter for Bunny.net credentials.
 *
 * Reads runtime env vars and fails fast with a descriptive error if a
 * required variable is missing. Values are NEVER hardcoded.
 */

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === null || value === "") {
    throw new Error(
      `[bunny] Missing required environment variable: ${name}. ` +
        `Please set it in your .env file or runtime environment.`,
    );
  }
  return value;
}

export interface BunnyStreamEnv {
  apiKey: string;
  libraryId: string;
  cdnHostname: string;
}

export interface BunnyStorageEnv {
  zone: string;
  accessKey: string;
  readonlyKey: string;
  cdnHostname: string;
}

export function getBunnyStreamEnv(): BunnyStreamEnv {
  return {
    apiKey: requireEnv("BUNNY_STREAM_API_KEY"),
    libraryId: requireEnv("BUNNY_STREAM_LIBRARY_ID"),
    cdnHostname: requireEnv("BUNNY_STREAM_CDN_HOSTNAME"),
  };
}

export function getBunnyStorageEnv(): BunnyStorageEnv {
  return {
    zone: requireEnv("BUNNY_STORAGE_ZONE"),
    accessKey: requireEnv("BUNNY_STORAGE_ACCESS_KEY"),
    readonlyKey: requireEnv("BUNNY_STORAGE_READONLY_KEY"),
    cdnHostname: requireEnv("BUNNY_STORAGE_CDN_HOSTNAME"),
  };
}
