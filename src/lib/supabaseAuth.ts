import { createClient } from "@supabase/supabase-js";
import { env } from "../config/env";

export const createSupabaseAuthClient = () =>
  createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
