import { ConnectionConfig } from '../models/types';

/**
 * Parse PostgreSQL connection string
 * Formats:
 *   postgresql://user:password@host:port/database?sslmode=require
 *   postgres://user:password@host:port/database
 *   host:port/database (user/password prompted separately)
 */
export function parseConnectionString(connStr: string): Partial<ConnectionConfig> | null {
  try {
    // Handle postgresql:// or postgres:// URLs
    if (connStr.startsWith('postgresql://') || connStr.startsWith('postgres://')) {
      return parseUrl(connStr);
    }

    // Handle simple format: host:port/database or host/database
    return parseSimpleFormat(connStr);
  } catch {
    return null;
  }
}

function parseUrl(urlStr: string): Partial<ConnectionConfig> {
  const url = new URL(urlStr);

  const config: Partial<ConnectionConfig> = {
    host: url.hostname || 'localhost',
    port: url.port ? parseInt(url.port, 10) : 5432,
    database: url.pathname.slice(1) || 'postgres',
    user: url.username || 'postgres',
  };

  if (url.password) {
    config.password = decodeURIComponent(url.password);
  }

  // Parse query params
  const sslMode = url.searchParams.get('sslmode');
  if (sslMode && sslMode !== 'disable') {
    config.ssl = true;
  }

  return config;
}

function parseSimpleFormat(str: string): Partial<ConnectionConfig> | null {
  // Format: host:port/database or host/database
  const match = str.match(/^([^:\/]+)(?::(\d+))?(?:\/(.+))?$/);
  if (!match) {
    return null;
  }

  return {
    host: match[1] || 'localhost',
    port: match[2] ? parseInt(match[2], 10) : 5432,
    database: match[3] || 'postgres',
  };
}

export function buildConnectionString(config: ConnectionConfig): string {
  const auth = config.password
    ? `${encodeURIComponent(config.user)}:${encodeURIComponent(config.password)}@`
    : `${encodeURIComponent(config.user)}@`;

  const ssl = config.ssl ? '?sslmode=require' : '';

  return `postgresql://${auth}${config.host}:${config.port}/${config.database}${ssl}`;
}
