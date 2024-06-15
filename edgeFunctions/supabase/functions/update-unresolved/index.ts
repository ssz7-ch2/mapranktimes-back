// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getAccessToken, getMapsUnresolved } from "../_shared/osuFunctions.ts";
import { Database } from "../_shared/database.types.ts";

Deno.serve(async (_req) => {
  const supabase = createClient<Database>(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  let accessToken = appData.access_token;
  let expireDate = appData.expire_date;

  if (accessToken === null || Date.now() >= expireDate) {
    [accessToken, expireDate] = await getAccessToken();
    const { error } = await supabase
      .from("app_data")
      .update({
        access_token: accessToken,
        expire_date: expireDate,
      })
      .eq("id", 1);
    if (error) console.log(error);
  }

  const mapsToUpdate: { id: number; unresolved: boolean }[] = [];
  const updatedMaps: number[] = [];

  const { data: unresolvedMaps, error: errorUnresolved } = await supabase
    .from("beatmapsets")
    .select("*")
    .is("unresolved", true);
  if (!unresolvedMaps || errorUnresolved) {
    throw new Error(`failed to get unresolvedMaps. Error: ${errorUnresolved}`);
  }

  const updatedUnresolvedMaps = await getMapsUnresolved(accessToken);
  const unresolvedMapIds = updatedUnresolvedMaps.map((beatmapSet) =>
    beatmapSet.id
  );
  unresolvedMaps.forEach((beatmapSet) => {
    if (!unresolvedMapIds.includes(beatmapSet.id)) {
      mapsToUpdate.push({
        id: beatmapSet.id,
        unresolved: false,
      });
      updatedMaps.push(beatmapSet.id);
    } else {
      // remove maps that are in both
      // remaining ids will be newly unresolved maps
      unresolvedMapIds.splice(unresolvedMapIds.indexOf(beatmapSet.id), 1);
    }
  });

  unresolvedMapIds.forEach((beatmapSetId) => {
    mapsToUpdate.push({
      id: beatmapSetId,
      unresolved: true,
    });
    updatedMaps.push(beatmapSetId);
  });

  for (const beatmapSet of mapsToUpdate) {
    // use update here since mapsToUpdate.length is usually around 0-1
    const { error } = await supabase
      .from("beatmapsets")
      .update({ unresolved: beatmapSet.unresolved })
      .eq("id", beatmapSet.id);
    if (error) console.log(error);
  }

  if (updatedMaps.length > 0) {
    const { error } = await supabase
      .from("updates")
      .upsert({ id: 1, updated_maps: updatedMaps, deleted_maps: [] });
    if (error) console.log(error);
  }

  const message = `${mapsToUpdate.length} map${
    mapsToUpdate.length === 1 ? "" : "s"
  } updated`;
  console.log(`${new Date().toISOString()} - ${message}`);

  return new Response(JSON.stringify({ message }), {
    headers: { "Content-Type": "application/json" },
  });
});
