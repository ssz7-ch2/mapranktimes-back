import { createClient } from "@supabase/supabase-js";
import { getBeatmapSet } from "./osuRequests";
import { Database } from "./database.types";
import { beatmapSetToDatabase, databaseToSplitModes } from "./utils";
import { DAY, HOUR } from "./timeConstants";
import { adjustRankDates, calcEarlyProbability } from "./osuHelpers";
import { BeatmapSetDatabase } from "./beatmap.types";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const insertMap = async (beatmapSetId: number) => {
  var { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  const { data: qualifiedData, error: errorQualified } = await supabase
    .from("beatmapsets")
    .select("*")
    .not("queue_date", "is", null);

  const { data: rankedData, error: errorRanked } = await supabase
    .from("beatmapsets")
    .select("*")
    .is("queue_date", null)
    .gt("rank_date", Math.floor((Date.now() - DAY - HOUR) / 1000));

  if (!rankedData || !qualifiedData) {
    throw new Error(
      `missing data. errorQualified ${errorQualified}\nerrorRanked ${errorRanked}`,
    );
  }

  const previousData: {
    [key: number]: [number, number | null, number | null];
  } = {};

  qualifiedData.forEach((beatmapSet) => {
    previousData[beatmapSet.id] = [
      beatmapSet.rank_date,
      beatmapSet.rank_date_early,
      beatmapSet.probability,
    ];
  });

  const qualifiedMaps = databaseToSplitModes(
    qualifiedData.sort((a, b) => a.queue_date! - b.queue_date!),
  );
  const rankedMaps = databaseToSplitModes(
    rankedData.sort((a, b) => a.rank_date - b.rank_date),
  );

  const newBeatmapSet = await getBeatmapSet(appData.access_token, beatmapSetId);

  if (newBeatmapSet.queueDate) {
    // need to make sure to delete map from database before running
    qualifiedMaps[newBeatmapSet.mode].push(newBeatmapSet);
    qualifiedMaps[newBeatmapSet.mode].sort((a, b) =>
      a.queueDate!.getTime() - b.queueDate!.getTime()
    );
  } else {
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

  const mapsToUpdate: BeatmapSetDatabase[] = [];
  const updatedMaps: number[] = [];

  qualifiedMaps.forEach((beatmapSets) => {
    beatmapSets.forEach((beatmapSet) => {
      const currentData = [
        beatmapSet.rankDate!.getTime() / 1000,
        beatmapSet.rankDateEarly!.getTime() / 1000,
        beatmapSet.probability,
      ];

      // if rankDate/rankDateEarly/probability has changed or new qualified map
      if (
        !(beatmapSet.id in previousData) ||
        previousData[beatmapSet.id].reduce(
          (updated, value, i) => updated || currentData[i] !== value,
          false,
        )
      ) {
        console.log(beatmapSet.id, previousData[beatmapSet.id], currentData);
        mapsToUpdate.push(beatmapSetToDatabase(beatmapSet));
        updatedMaps.push(beatmapSet.id);
      }
    });
  });

  const { error: errorBeatmapSets } = await supabase.from("beatmapsets").upsert(
    mapsToUpdate,
  );
  if (errorBeatmapSets) console.log(errorBeatmapSets);

  if (updatedMaps.length > 0) {
    const { error } = await supabase
      .from("updates")
      .upsert({ id: 1, updated_maps: updatedMaps, deleted_maps: [] });
    if (error) console.log(error);
  }
};

insertMap(0);
