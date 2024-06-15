// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Database } from "../_shared/database.types.ts";

Deno.serve(async (_req) => {
  const supabase = createClient<Database>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data, error } = await supabase
    .from("beatmapsets")
    .delete()
    .is("queue_date", null)
    .lt("rank_date", Math.floor((Date.now() - 7 * 86400000) / 1000))
    .select();

  if (!data || error) {
    throw new Error("failed to delete ranked maps");
  }

  const message = `${
    new Date().toISOString()
  } - Removed ${data.length} ranked map${data.length === 1 ? "" : "s"}.`;
  console.log(message);

  return new Response(JSON.stringify({ message }), {
    headers: { "Content-Type": "application/json" },
  });
});
