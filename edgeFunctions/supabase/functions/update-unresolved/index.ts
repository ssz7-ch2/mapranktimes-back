// Follow this setup guide to integrate the Deno language server with your editor:
// https://deno.land/manual/getting_started/setup_your_environment
// This enables autocomplete, go to definition, etc.

// Setup type definitions for built-in Supabase Runtime APIs
/// <reference types="https://esm.sh/@supabase/functions-js/src/edge-runtime.d.ts" />

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  adjustAllRankDates,
  getAccessToken,
  getFormattedMapsFromDatabase,
  getMapsUnresolved,
  getUpdatedMaps,
  storeMapProperties,
} from "../_shared/osuFunctions.ts";
import { Database } from "../_shared/database.types.ts";
import { Redis } from "npm:@upstash/redis@^1.31.5";

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

  const { qualifiedMaps, rankedMaps, qualifiedData } =
    await getFormattedMapsFromDatabase(supabase);

  const previousData = storeMapProperties(qualifiedData);

  const updatedUnresolvedMaps = await getMapsUnresolved(accessToken);
  const unresolvedMapIds = updatedUnresolvedMaps.map((beatmapSet) =>
    beatmapSet.id
  );

  // idk if there's a better way to do this
  qualifiedMaps.forEach((beatmapSets) =>
    beatmapSets.forEach((beatmapSet) => {
      if (!unresolvedMapIds.includes(beatmapSet.id)) {
        beatmapSet.unresolved = false;
      } else {
        beatmapSet.unresolved = true;
      }
    })
  );

  adjustAllRankDates(qualifiedMaps, rankedMaps);

  const { mapsToUpdate, updatedMapIds } = getUpdatedMaps(
    qualifiedMaps,
    previousData,
  );

  const { error: errorBeatmapSets } = await supabase.from("beatmapsets").upsert(
    mapsToUpdate,
  );
  if (errorBeatmapSets) console.log(errorBeatmapSets);

  if (updatedMapIds.length > 0) {
    const redis = Redis.fromEnv();
    const timestamp = Date.now();

    redis.set(`updates-${timestamp}`, JSON.stringify(mapsToUpdate), { ex: 60 });

    const { error } = await supabase
      .from("updates")
      .upsert({
        id: 1,
        timestamp,
        updated_maps: updatedMapIds,
        deleted_maps: [],
      });
    if (error) console.log(error);
  }

  const message = `${mapsToUpdate.length} map${
    mapsToUpdate.length === 1 ? "" : "s"
  } updated`;
  console.log(`${new Date().toISOString()} - ${message}`);
  console.log(updatedMapIds);

  return new Response(JSON.stringify({ message }), {
    headers: { "Content-Type": "application/json" },
  });
});
