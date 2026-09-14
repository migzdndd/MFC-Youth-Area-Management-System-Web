import { neon } from '@neondatabase/serverless';
import { assertBackendConfigured } from './env.js';

let cachedUrl = '';
let cachedSql = null;

function sqlClient() {
  const { databaseUrl } = assertBackendConfigured();
  if (!cachedSql || cachedUrl !== databaseUrl) {
    cachedUrl = databaseUrl;
    cachedSql = neon(databaseUrl);
  }
  return cachedSql;
}

async function withTimeout(promise, timeoutMs = 10000) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      const error = new Error('Database request timed out.');
      error.statusCode = 503;
      error.code = 'DATABASE_TIMEOUT';
      reject(error);
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export async function query(text, params = [], timeoutMs = 10000) {
  const sql = sqlClient();
  return withTimeout(sql(text, params), timeoutMs);
}

export async function queryOne(text, params = [], timeoutMs = 10000) {
  const rows = await query(text, params, timeoutMs);
  return Array.isArray(rows) && rows.length ? rows[0] : null;
}

export async function pingDatabase() {
  const row = await queryOne('SELECT 1 AS ok');
  return row?.ok === 1;
}
