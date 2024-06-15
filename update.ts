import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getBeatmapSet, getEventsAfter } from "./osuRequests";
import { beatmapSetToDatabase, databaseToSplitModes } from "./utils";
import { Database } from "./database.types";
import { DAY, HOUR } from "./timeConstants";
import { BeatmapSet, BeatmapSetDatabase } from "./beatmap.types";
import { adjustRankDates, calcEarlyProbability } from "./osuHelpers";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const removeMapFromQualified = (
  qualifiedMaps: BeatmapSet[][],
  beatmapSetId: number,
): [BeatmapSet, number] => {
  // have to loop through all since mapEvent has no mode info :(
  for (const beatmapSets of qualifiedMaps) {
    for (let i = 0; i < beatmapSets.length; i++) {
      if (beatmapSets[i].id == beatmapSetId) {
        return [beatmapSets.splice(i, 1)[0], i];
      }
    }
  }

  throw new Error(`${beatmapSetId} not found in qualifiedMaps`);
};

const rankEvent = async (
  qualifiedMaps: BeatmapSet[][],
  rankedMaps: BeatmapSet[][],
  beatmapSetId: number,
  rankedDate: Date,
) => {
  const [beatmapSetTarget, start] = removeMapFromQualified(
    qualifiedMaps,
    beatmapSetId,
  );

  console.log(
    new Date().toISOString(),
    `- new rank event for beatmapset ${beatmapSetId} at ${rankedDate.toISOString()} (calculated ${
      beatmapSetTarget.rankDate!.toISOString()
    }, ${
      beatmapSetTarget.rankDateEarly!.toISOString()
    }, ${beatmapSetTarget.probability})`,
  );

  beatmapSetTarget.rankDate = rankedDate;
  beatmapSetTarget.rankDateEarly = null;
  beatmapSetTarget.queueDate = null;

  rankedMaps[beatmapSetTarget.mode].push(beatmapSetTarget);
  adjustRankDates(
    qualifiedMaps[beatmapSetTarget.mode],
    rankedMaps[beatmapSetTarget.mode],
    start,
  );

  const { error } = await supabase
    .from("beatmapsets")
    .update({
      queue_date: null,
      rank_date: rankedDate.getTime() / 1000,
      rank_date_early: null,
    })
    .eq("id", beatmapSetId);
  if (error) console.log(error);
};

const qualifyEvent = async (
  qualifiedMaps: BeatmapSet[][],
  rankedMaps: BeatmapSet[][],
  beatmapSetId: number,
  accessToken: string,
) => {
  // need to wait for adjustRankTimes to insert into database
  const newBeatmapSet = await getBeatmapSet(accessToken, beatmapSetId);

  // reverse order since usually new qualified maps are added near the end of list
  let i = qualifiedMaps[newBeatmapSet.mode].length;
  if (i === 0) {
    qualifiedMaps[newBeatmapSet.mode].push(newBeatmapSet);
  } else {
    for (; i > 0; i--) {
      if (
        newBeatmapSet.queueDate! >=
          qualifiedMaps[newBeatmapSet.mode][i - 1].queueDate!
      ) {
        qualifiedMaps[newBeatmapSet.mode].splice(i, 0, newBeatmapSet);
        break;
      }
    }
  }

  adjustRankDates(
    qualifiedMaps[newBeatmapSet.mode],
    rankedMaps[newBeatmapSet.mode],
    i,
  );
};

const disqualifyEvent = async (
  qualifiedMaps: BeatmapSet[][],
  rankedMaps: BeatmapSet[][],
  beatmapSetId: number,
) => {
  const [beatmapSetTarget, start] = removeMapFromQualified(
    qualifiedMaps,
    beatmapSetId,
  );
  adjustRankDates(
    qualifiedMaps[beatmapSetTarget.mode],
    rankedMaps[beatmapSetTarget.mode],
    start,
  );

  const { error } = await supabase.from("beatmapsets").delete().eq(
    "id",
    beatmapSetId,
  );
  console.log(error);
};

const checkEvents = async (accessToken: string, lastEventId: number) => {
  const [newEvents, newLastEventId] = await getEventsAfter(
    accessToken,
    lastEventId,
  );

  console.log(
    new Date().toISOString(),
    `- ${newEvents.length} new event${newEvents.length === 1 ? "" : "s"}`,
  );
  if (newEvents.length === 0) return newLastEventId;

  // keep track of state before change
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

  let currentEventId: number;

  const updatedMaps: number[] = [];
  const deletedMaps: number[] = [];

  try {
    for (const mapEvent of newEvents) {
      if (mapEvent.type !== "rank") {
        console.log(
          new Date().toISOString(),
          `- new ${mapEvent.type} event for beatmapset ${mapEvent.beatmapSetId} at ${mapEvent.createdAt.toISOString()}`,
        );
      }
      switch (mapEvent.type) {
        case "rank":
          await rankEvent(
            qualifiedMaps,
            rankedMaps,
            mapEvent.beatmapSetId,
            mapEvent.createdAt,
          );
          // deleted from client side
          deletedMaps.push(mapEvent.beatmapSetId);
          break;
        case "qualify":
          await qualifyEvent(
            qualifiedMaps,
            rankedMaps,
            mapEvent.beatmapSetId,
            accessToken,
          );
          break;
        case "disqualify":
          await disqualifyEvent(
            qualifiedMaps,
            rankedMaps,
            mapEvent.beatmapSetId,
          );
          deletedMaps.push(mapEvent.beatmapSetId);
          break;
        default:
          break;
      }
      currentEventId = mapEvent.id;
    }
  } finally {
    currentEventId = newLastEventId;
  }

  calcEarlyProbability(qualifiedMaps);

  const mapsToUpdate: BeatmapSetDatabase[] = [];

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

  const { error } = await supabase.from("beatmapsets").upsert(mapsToUpdate);
  if (error) console.log(error);

  if (updatedMaps.length + deletedMaps.length > 0) {
    const { error } = await supabase
      .from("updates")
      .upsert({ id: 1, updated_maps: updatedMaps, deleted_maps: deletedMaps });
    if (error) console.log(error);
  }

  return currentEventId;
};

const update = async () => {
  const { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  let updateAppData = false;

  let accessToken = appData.access_token;
  let expireDate = appData.expire_date;

  if (accessToken === null || Date.now() >= expireDate) {
    [accessToken, expireDate] = await getAccessToken();
    updateAppData = true;
  }

  const newLastEventId = await checkEvents(accessToken, appData.last_event_id);
  if (newLastEventId !== appData.last_event_id) updateAppData = true;

  if (updateAppData) {
    const { error } = await supabase
      .from("app_data")
      .upsert([
        {
          id: 1,
          access_token: accessToken,
          expire_date: expireDate,
          last_event_id: newLastEventId,
        },
      ])
      .select();
    if (error) console.log(error);
  }
};

if (require.main === module) {
  update();
}