/**
 * Supabase client singleton.
 * Uses CONFIG for credentials — no hardcoded secrets.
 */
const { createClient } = require('@supabase/supabase-js');
const CONFIG = require('./config');

let supabase = null;

function getSupabase() {
  if (supabase) return supabase;
  supabase = createClient(CONFIG.supabase.url, CONFIG.supabase.serviceKey);
  return supabase;
}

module.exports = { getSupabase };
