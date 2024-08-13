import { createClient } from "@supabase/supabase-js";
import { getBeatmapSet } from "./osuRequests";
import { Database } from "./database.types";
import {
  adjustRankDates,
  calcEarlyProbability,
  getFormattedMapsFromDatabase,
  getUpdatedMaps,
  storeMapProperties,
} from "./osuHelpers";
import { Redis } from "@upstash/redis";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const insertMap = async (beatmapSetId: number) => {
  var { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  const { qualifiedMaps, rankedMaps, qualifiedData } =
    await getFormattedMapsFromDatabase(supabase);

  const previousData = storeMapProperties(qualifiedData);

  const newBeatmapSet = await getBeatmapSet(appData.access_token, beatmapSetId);

  if (newBeatmapSet.queueDate) {
    qualifiedMaps[newBeatmapSet.mode] = qualifiedMaps[newBeatmapSet.mode]
      .filter((beatmapSet) => beatmapSet.id !== newBeatmapSet.id);
    qualifiedMaps[newBeatmapSet.mode].push(newBeatmapSet);
    qualifiedMaps[newBeatmapSet.mode].sort((a, b) =>
      a.queueDate!.getTime() - b.queueDate!.getTime()
    );
  } else {
    rankedMaps[newBeatmapSet.mode] = rankedMaps[newBeatmapSet.mode].filter(
      (beatmapSet) => beatmapSet.id !== newBeatmapSet.id,
    );
    rankedMaps[newBeatmapSet.mode].push(newBeatmapSet);
    rankedMaps[newBeatmapSet.mode].sort((a, b) =>
      a.rankDate!.getTime() - b.rankDate!.getTime()
    );
  }

  adjustRankDates(
    qualifiedMaps[newBeatmapSet.mode],
    rankedMaps[newBeatmapSet.mode],
  );
  calcEarlyProbability(qualifiedMaps);

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
};

insertMap(0);
