import { DAY, MINUTE } from "./timeConstants";
import { MINIMUM_DAYS_FOR_RANK, RANK_PER_DAY } from "./config";
import { beatmapSetFromAPI, mapEventFromAPI } from "./utils";
import {
  BeatmapSet,
  BeatmapSetAPI,
  MapEvent,
  MapEventAPI,
} from "./beatmap.types";

require("dotenv").config();

export const getAccessToken = async (): Promise<[string, number]> => {
  const body = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "public",
  };

  const response = await fetch("https://osu.ppy.sh/oauth/token", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  const data = (await response.json()) as {
    access_token: string;
    expires_in: number;
  };

  if (!response.ok || !data) throw new Error("failed to get accessToken");

  return [data.access_token, Date.now() + (data.expires_in - 3600) * 1000];
};

async function getAPI<T>(url: string, accessToken: string): Promise<T> {
  const response = await fetch(url, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  const data = (await response.json()) as T;

  if (!response.ok || !data) throw new Error(`failed to fetch ${url}`);

  return data;
}

export const getBeatmapSet = async (
  accessToken: string,
  beatmapSetId: number,
) => {
  const data = await getAPI<BeatmapSetAPI>(
    `https://osu.ppy.sh/api/v2/beatmapsets/${beatmapSetId}`,
    accessToken,
  );

  const beatmapSet = beatmapSetFromAPI(data);
  if (data.status !== "ranked") {
    await setQueueDate(beatmapSet, accessToken);

    // very unlikely that a map has unresolved mods right after getting qualified
    // await setUnresolved(beatmapSet, accessToken);
  }

  return beatmapSet;
};

export const getQualifiedMaps = async (accessToken: string) => {
  const dataList: BeatmapSetAPI[] = [];
  let page = 1;
  while (true) {
    const data = await getAPI<{ beatmapsets: BeatmapSetAPI[] }>(
      `https://osu.ppy.sh/api/v2/beatmapsets/search?s=qualified&sort=ranked_asc&nsfw=true&page=${page}`,
      accessToken,
    );

    dataList.push(...data.beatmapsets);
    if (data.beatmapsets.length < 50) break;
    page++;
  }

  if (process.env.MAPS_COUNT) {
    dataList.splice(parseInt(process.env.MAPS_COUNT));
  }

  const qualifiedMaps: BeatmapSet[][] = [[], [], [], []];
  for (const item of dataList) {
    const beatmapSet = beatmapSetFromAPI(item);

    await setQueueDate(beatmapSet, accessToken);
    await setUnresolved(beatmapSet, accessToken);

    qualifiedMaps[beatmapSet.mode].push(beatmapSet);
  }

  return qualifiedMaps;
};

export const getRankedMaps = async (accessToken: string) => {
  const dataList: BeatmapSetAPI[] = [];
  let page = 1;
  while (true) {
    const data = await getAPI<{ beatmapsets: BeatmapSetAPI[] }>(
      `https://osu.ppy.sh/api/v2/beatmapsets/search?s=ranked&nsfw=true&q=ranked>${
        Math.floor(
          (Date.now() - (7 * DAY + 60 * MINUTE)) / 1000,
        )
      }&page=${page}`,
      accessToken,
    );

    dataList.push(...data.beatmapsets);
    if (data.beatmapsets.length < 50) break;
    page++;
  }

  const rankedMaps: BeatmapSet[][] = [[], [], [], []];
  dataList.reverse().forEach((beatmapSetData) => {
    const beatmapSet = beatmapSetFromAPI(beatmapSetData);
    rankedMaps[beatmapSet.mode].push(beatmapSet);
  });

  if (process.env.MAPS_COUNT) {
    rankedMaps.forEach((beatmapSets) => {
      beatmapSets.splice(
        0,
        beatmapSets.length -
          Math.max(RANK_PER_DAY, parseInt(process.env.MAPS_COUNT!)),
      );
    });
  }

  return rankedMaps;
};

export const getMapEvents = async (
  accessToken: string,
  beatmapSetId: number,
) => {
  const url =
    `https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=disqualify&beatmapset_id=${beatmapSetId}&limit=50`;
  const data = await getAPI<{ events: MapEventAPI[] }>(url, accessToken);

  return data.events;
};

const getMapUnresolved = async (accessToken: string, beatmapSetId: number) => {
  const url =
    `https://osu.ppy.sh/api/v2/beatmapsets/discussions?beatmapset_id=${beatmapSetId}&message_types[]=suggestion&message_types[]=problem&only_unresolved=true`;
  const data = await getAPI<{ discussions: any[] }>(url, accessToken);
  return data.discussions.length > 0;
};

export const getMapsUnresolved = async (accessToken: string) => {
  const url =
    `https://osu.ppy.sh/api/v2/beatmapsets/discussions?beatmapset_status=qualified&message_types[]=suggestion&message_types[]=problem&only_unresolved=true&limit=50`;
  const data = await getAPI<{ beatmapsets: BeatmapSetAPI[] }>(url, accessToken);
  return data.beatmapsets;
};

export const getEventsAfter = async (
  accessToken: string,
  lastEventId: number,
  limit = 5,
): Promise<[MapEvent[], number]> => {
  let page = 1;
  let apiCalls = 0;
  const newEvents: MapEvent[] = [];
  const newEventIds: number[] = [];
  let newLastEventId: number;

  while (true) {
    const data = await getAPI<{ events: MapEventAPI[] }>(
      `https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=rank&types[]=disqualify&limit=${limit}&page=${page}`,
      accessToken,
    );
    apiCalls++;
    newLastEventId ??= data.events[0].id;
    for (const event of data.events) {
      if (event.id == lastEventId) return [newEvents.reverse(), newLastEventId];

      // skip duplicates caused by timeout
      if (newEventIds.includes(event.id)) continue;

      newEvents.push(mapEventFromAPI(event));
      newEventIds.push(event.id);
    }
    if (apiCalls > 30) {
      await new Promise((resolve) => setTimeout(resolve, 60000));
      apiCalls = 0;
    }
    page++;
  }
};

export const getLatestEvent = async (accessToken: string) => {
  const data = await getAPI<{ events: MapEventAPI[] }>(
    "https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=rank&types[]=disqualify&limit=5",
    accessToken,
  );
  return data.events[0].id;
};

let lastRequestDate = 0;

const setUnresolved = async (beatmapSet: BeatmapSet, accessToken: string) => {
  if (Date.now() - lastRequestDate < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  beatmapSet.unresolved = await getMapUnresolved(accessToken, beatmapSet.id);
  lastRequestDate = Date.now();
};

const setQueueDate = async (beatmapSet: BeatmapSet, accessToken: string) => {
  if (Date.now() - lastRequestDate < 1000) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }

  console.log(
    new Date().toISOString(),
    `- calculating queueDate for ${beatmapSet.id} ${beatmapSet.artist} - ${beatmapSet.title}`,
  );

  const events = (await getMapEvents(accessToken, beatmapSet.id))
    .map((event) => ({
      type: event.type,
      time: Date.parse(event.created_at),
    }))
    .reverse();
  lastRequestDate = Date.now();

  let previousQueueDuration = 0;
  let startDate: number | null = null;

  events.forEach((event) => {
    switch (event.type) {
      case "qualify":
        startDate = event.time;
        break;
      case "disqualify":
        if (startDate != null) {
          previousQueueDuration += event.time - startDate;
        }
        break;
      case "rank":
        previousQueueDuration = 0;
        break;
      default:
        break;
    }
  });

  // all maps need to be qualified for at least 7 days
  const queueDuration = MINIMUM_DAYS_FOR_RANK * DAY;

  const timeLeft = queueDuration - previousQueueDuration;

  // maps need to be qualified for at least 1 day since lastest qualified date
  beatmapSet.queueDate = new Date(
    beatmapSet.lastQualifiedDate!.getTime() + Math.max(DAY, timeLeft),
  );

  console.log(new Date().toISOString(), "- success");
};
