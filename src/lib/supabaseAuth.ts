import { createClient } from "@supabase/supabase-js";
import type { WebSocketLikeConstructor } from "@supabase/realtime-js";
import WebSocket from "ws";
import { env } from "../config/env";

const websocketTransport = WebSocket as unknown as WebSocketLikeConstructor;

export const createSupabaseAuthClient = () =>
  createClient(
    env.SUPABASE_URL,
    env.SUPABASE_ANON_KEY ?? env.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
      realtime: {
        transport: websocketTransport,
      },
    }
  );
