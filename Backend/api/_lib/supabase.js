import { createClient } from '@supabase/supabase-js';
import { assertBackendConfigured } from './env.js';

const REQUEST_TIMEOUT_MS = 10000;

function secureFetch(input, init = {}) {
  const target = typeof input === 'string' ? input : input?.url;
  if (target) {
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:') {
      throw new Error('Blocked insecure database transport. Supabase requests must use HTTPS.');
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  const upstreamSignal = init.signal;

  if (upstreamSignal) {
    if (upstreamSignal.aborted) controller.abort();
    else upstreamSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }

  return fetch(input, {
    ...init,
    signal: controller.signal,
    redirect: 'error',
    cache: 'no-store'
  }).finally(() => clearTimeout(timeout));
}

function clientOptions() {
  return {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    },
    global: {
      fetch: secureFetch,
      headers: {
        'X-Client-Info': 'mfc-youth-web-api'
      }
    }
  };
}

export function createSupabaseAdmin() {
  const { supabaseUrl, supabaseServiceRoleKey } = assertBackendConfigured();
  return createClient(supabaseUrl, supabaseServiceRoleKey, clientOptions());
}

export function createSupabaseAuthClient() {
  const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
  return createClient(supabaseUrl, supabaseAnonKey, clientOptions());
}
