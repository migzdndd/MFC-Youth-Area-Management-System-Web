import { createClient } from '@supabase/supabase-js';
import { assertBackendConfigured } from './env.js';

export function createSupabaseAdmin() {
  const { supabaseUrl, supabaseServiceRoleKey } = assertBackendConfigured();
  return createClient(supabaseUrl, supabaseServiceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}

export function createSupabaseAuthClient() {
  const { supabaseUrl, supabaseAnonKey } = assertBackendConfigured();
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
}
