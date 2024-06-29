import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getMapsUnresolved } from "./osuRequests";
import { Database } from "./database.types";
import { Redis } from "@upstash/redis";
import {
  adjustAllRankDates,
  getFormattedMapsFromDatabase,
  getUpdatedMaps,
  storeMapProperties,
} from "./osuHelpers";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const updateUnresolved = async () => {
  let { data: res, error } = await supabase.from("app_data").select("*");
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

  console.log(mapsToUpdate);

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
};

if (require.main === module) {
  updateUnresolved();
}
