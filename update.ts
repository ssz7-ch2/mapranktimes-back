import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getBeatmapSet, getEventsAfter } from "./osuRequests";
import { Database } from "./database.types";
import { BeatmapSet } from "./beatmap.types";
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
  const [beatmapSetTarget] = removeMapFromQualified(
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
  beatmapSetTarget.unresolved = false;
  beatmapSetTarget.probability = null;

  rankedMaps[beatmapSetTarget.mode].push(beatmapSetTarget);
  adjustRankDates(
    qualifiedMaps[beatmapSetTarget.mode],
    rankedMaps[beatmapSetTarget.mode],
  );

  const { error } = await supabase
    .from("beatmapsets")
    .update({
      queue_date: null,
      rank_date: rankedDate.getTime() / 1000,
      rank_date_early: null,
      unresolved: false,
      probability: null,
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
  for (; i >= 0; i--) {
    if (
      i === 0 || newBeatmapSet.queueDate! >=
        qualifiedMaps[newBeatmapSet.mode][i - 1].queueDate!
    ) {
      qualifiedMaps[newBeatmapSet.mode].splice(i, 0, newBeatmapSet);
      break;
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
  let [newEvents, newLastEventId] = await getEventsAfter(
    accessToken,
    lastEventId,
  );

  console.log(
    new Date().toISOString(),
    `- ${newEvents.length} new event${newEvents.length === 1 ? "" : "s"}`,
  );
  if (newEvents.length === 0) return newLastEventId;

  // newEvents = newEvents.slice(0, 1);
  // newLastEventId = newEvents[0].id;

  const { qualifiedMaps, rankedMaps, qualifiedData } =
    await getFormattedMapsFromDatabase(supabase);

  // keep track of state before change
  const previousData = storeMapProperties(qualifiedData);

  let currentEventId: number;

  let deletedMapIds: number[] = [];

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
          deletedMapIds.push(mapEvent.beatmapSetId);
          break;
        case "qualify":
          await qualifyEvent(
            qualifiedMaps,
            rankedMaps,
            mapEvent.beatmapSetId,
            accessToken,
          );
          // if a map is disqualified and immediately requalified, the map will still be in deletedMaps
          // so we need to remove it
          deletedMapIds = deletedMapIds.filter((mapId) =>
            mapId !== mapEvent.beatmapSetId
          );
          break;
        case "disqualify":
          await disqualifyEvent(
            qualifiedMaps,
            rankedMaps,
            mapEvent.beatmapSetId,
          );
          deletedMapIds.push(mapEvent.beatmapSetId);
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

  const { mapsToUpdate, updatedMapIds } = getUpdatedMaps(
    qualifiedMaps,
    previousData,
  );

  const { error } = await supabase.from("beatmapsets").upsert(mapsToUpdate);
  if (error) console.log(error);

  const timestamp = Date.now();

  if (mapsToUpdate.length > 0) {
    const redis = Redis.fromEnv();

    redis.set(`updates-${timestamp}`, JSON.stringify(mapsToUpdate), {
      ex: 60,
    });
  }

  if (updatedMapIds.length + deletedMapIds.length > 0) {
    const { error } = await supabase
      .from("updates")
      .upsert({
        id: 1,
        timestamp,
        updated_maps: updatedMapIds,
        deleted_maps: deletedMapIds,
      });
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
