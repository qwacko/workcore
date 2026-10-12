const host = process.env.HOST ?? '127.100.0.10';
const configuredPort = Number(process.env.PORT ?? 3000);
export const authBaseURL = process.env.BETTER_AUTH_URL ?? `http://${host}:${configuredPort}`;

export const serverConfig = {
  host,
  port: configuredPort,
  authBaseURL,
};

const defaultOrigin = new URL(serverConfig.authBaseURL).origin;

function origins(value: string | undefined, fallback: string) {
  return (value ?? fallback).split(',').map((origin) => origin.trim()).filter(Boolean);
}

export const betterAuthTrustedOrigins = origins(process.env.BETTER_AUTH_TRUSTED_ORIGINS, defaultOrigin);
export const workcoreTrustedOrigins = origins(process.env.WORKCORE_TRUSTED_ORIGINS, defaultOrigin);
