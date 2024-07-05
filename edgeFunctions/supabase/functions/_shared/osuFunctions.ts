import {
  Beatmap,
  BeatmapAPI,
  BeatmapSet,
  BeatmapSetAPI,
  BeatmapSetDatabase,
  MapEvent,
  MapEventAPI,
} from "./beatmap.types.ts";
import {
  DAY,
  DELAY_MAX,
  DELAY_MIN,
  HOUR,
  MINIMUM_DAYS_FOR_RANK,
  MINUTE,
  RANK_INTERVAL,
  RANK_PER_DAY,
  RANK_PER_RUN,
  SPLIT,
} from "./constants.ts";
import { permutations } from "npm:itertools@^2.3.2";
import { SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";
import { Database } from "./database.types.ts";

//#region utils.ts

const mapEventFromAPI = (
  { id, beatmapset, type, created_at }: MapEventAPI,
): MapEvent => {
  return {
    id,
    beatmapSetId: beatmapset.id,
    type,
    createdAt: new Date(created_at),
  };
};

const beatmapFromAPI = ({
  id,
  version,
  count_spinners,
  difficulty_rating,
  total_length,
  mode_int,
}: BeatmapAPI): Beatmap => {
  return {
    id,
    ver: version,
    spin: count_spinners,
    sr: difficulty_rating,
    len: total_length,
    mode: mode_int,
  };
};

const beatmapSetFromAPI = ({
  id,
  artist,
  title,
  creator,
  user_id,
  ranked_date,
  beatmaps,
  status,
}: BeatmapSetAPI): BeatmapSet => {
  return {
    id,
    queueDate: null,
    rankDate: status == "qualified" ? null : new Date(ranked_date),
    rankDateEarly: null,
    artist,
    title,
    mapper: creator,
    mapperId: user_id,
    probability: null,
    unresolved: false,
    beatmaps: beatmaps
      ?.map((beatmap) => beatmapFromAPI(beatmap))
      .sort((a, b) => (b.sr < a.sr ? 1 : -1)),
    mode: Math.min(...beatmaps.map((beatmap) => beatmap.mode_int)),
    lastQualifiedDate: status == "qualified" ? new Date(ranked_date) : null, // only used during setup
  };
};

export const beatmapSetToDatabase = ({
  id,
  queueDate,
  rankDate,
  rankDateEarly,
  artist,
  title,
  mapper,
  mapperId,
  probability,
  unresolved,
  beatmaps,
}: BeatmapSet): BeatmapSetDatabase => {
  return {
    id,
    queue_date: queueDate == null ? null : queueDate.getTime() / 1000,
    rank_date: rankDate!.getTime() / 1000,
    rank_date_early: rankDateEarly == null
      ? null
      : rankDateEarly.getTime() / 1000,
    artist,
    title,
    mapper,
    mapper_id: mapperId,
    probability,
    unresolved,
    beatmaps: JSON.stringify(beatmaps),
  };
};

const beatmapSetFromDatabase = ({
  id,
  queue_date,
  rank_date,
  rank_date_early,
  artist,
  title,
  mapper,
  mapper_id,
  probability,
  unresolved,
  beatmaps,
}: BeatmapSetDatabase): BeatmapSet => {
  const parsedBeatmaps: Beatmap[] = typeof beatmaps === "string"
    ? JSON.parse(beatmaps)
    : beatmaps;
  return {
    id,
    queueDate: queue_date == null ? null : new Date(queue_date * 1000),
    rankDate: new Date(rank_date * 1000),
    rankDateEarly: rank_date_early == null
      ? null
      : new Date(rank_date_early * 1000),
    artist,
    title,
    mapper,
    mapperId: mapper_id,
    probability,
    unresolved,
    beatmaps: parsedBeatmaps,
    mode: Math.min(...parsedBeatmaps.map((beatmap) => beatmap.mode)),
  };
};

export const databaseToSplitModes = (data: BeatmapSetDatabase[]) => {
  const splitMaps: BeatmapSet[][] = [[], [], [], []];
  data.forEach((item) => {
    const beatmapSet = beatmapSetFromDatabase(item);
    splitMaps[beatmapSet.mode].push(beatmapSet);
  });
  return splitMaps;
};

//#endregion

//#region probability.ts + distributions.ts

export function uniformSumCDF(n: number, x: number) {
  let sum = 0;
  if (x < 0) return 0;
  else if (x > n) return 1;
  else {
    for (let k = 0; k <= n; k++) {
      sum = sum +
        Math.pow(-1, k) * binomial(n, k) * sgn(x - k) * Math.pow(x - k, n);
    }
    return 0.5 + sum / (2 * factorial(n));
  }
}

function perm(n: number, k: number) {
  let p = 1;
  for (let i = 0; i < k; i++) p = p * (n - i);
  return p;
}

function factorial(n: number) {
  return perm(n, n);
}

function binomial(n: number, k: number) {
  if (k < 0 || k > n) return 0;
  else {
    let p = 1;
    for (let i = 0; i < k; i++) p = p * ((n - i) / (k - i));
    return p;
  }
}

function sgn(x: number) {
  if (x > 0) return 1;
  else if (x < 0) return -1;
  else return 0;
}

// **not 100% accurate when there are other modes with same rank date
//   calculation becomes much more complicated when accounting for other modes
// when beatmapSets == 0, probability represents when the ranking function runs
export const probabilityAfter = (seconds: number, otherModes?: number[]) => {
  let sum = 0;
  const memo: { [key: number]: number } = {};
  // calculate probability for each ranking position (1 means this gamemode is first in queue)
  for (let pos = 1; pos <= 4; pos++) {
    let modeSum = 0;

    let permSums = [0];
    if (otherModes) {
      if (pos == 2) permSums = otherModes;
      else if (pos === 3) {
        const temp: number[] = [];
        for (const perm of permutations(otherModes, 2)) {
          temp.push(perm.reduce((a, b) => a + b, 0));
        }
        permSums = temp;
      } else if (pos === 4) {
        permSums = [otherModes.reduce((a, b) => a + b, 0)];
      }
    }
    for (const permSum of permSums) {
      if (pos + permSum in memo) {
        modeSum += memo[pos + permSum];
        continue;
      }
      const transformed = (seconds - (pos + permSum) * DELAY_MIN) /
        (DELAY_MAX - DELAY_MIN);
      const value = 1 - uniformSumCDF(pos + permSum, transformed);
      memo[pos + permSum] = value;
      modeSum += value;
    }
    sum += modeSum / permSums.length;
  }
  return +`${(sum / 4)}`.slice(0, 7);
};

//#endregion

//#region osuRequests.ts

export const getAccessToken = async (): Promise<[string, number]> => {
  const body = {
    client_id: Deno.env.get("CLIENT_ID")!,
    client_secret: Deno.env.get("CLIENT_SECRET")!,
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
  if (data.status === "qualified") {
    await setQueueTime(beatmapSet, accessToken);

    // very unlikely that a map has unresolved mods right after getting qualified
    // await setUnresolved(beatmapSet, accessToken);
  }

  return beatmapSet;
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

export const setQueueTime = async (
  beatmapSet: BeatmapSet,
  accessToken: string,
) => {
  const events = (await getMapEvents(accessToken, beatmapSet.id))
    .map((event) => ({
      type: event.type,
      time: Date.parse(event.created_at),
    }))
    .reverse();

  let previousQueueDuration = 0;
  let startDate: number;

  events.forEach((event) => {
    if (event.type === "qualify") startDate = event.time;
    else if (event.type === "disqualify" && startDate != null) {
      previousQueueDuration += event.time - startDate;
    }
  });

  // all maps need to be qualified for at least 7 days
  const queueDuration = MINIMUM_DAYS_FOR_RANK * DAY;

  const timeLeft = queueDuration - previousQueueDuration;

  // maps need to be qualified for at least 1 day since lastest qualified date
  beatmapSet.queueDate = new Date(
    beatmapSet.lastQualifiedDate!.getTime() + Math.max(DAY, timeLeft),
  );
};

//#endregion

//#region osuHelpers.ts

// round milliseconds up or down to rank intervals and return new date
const roundMinutes = (milliseconds: number, down = false) =>
  (down
    ? Math.floor(milliseconds / (RANK_INTERVAL * MINUTE))
    : Math.ceil(milliseconds / (RANK_INTERVAL * MINUTE))) *
  (RANK_INTERVAL * MINUTE);

// time from previous interval in seconds
const intervalTimeDelta = (date: Date) =>
  (date.getUTCMinutes() % 20) * 60 + date.getSeconds();

// qualifiedMaps here is only one mode
export const adjustRankDates = (
  qualifiedMaps: BeatmapSet[],
  rankedMaps: BeatmapSet[],
  start = 0,
) => {
  const combined = [...rankedMaps, ...qualifiedMaps];
  for (let i = rankedMaps.length + start; i < combined.length; i++) {
    const qualifiedMap = combined[i];

    let compareMap: BeatmapSet | null = null;

    let count = 0;
    for (const beatmapSet of combined.slice(0, i).reverse()) {
      if (beatmapSet.unresolved) continue;
      count++;
      if (count === RANK_PER_DAY) compareMap = beatmapSet;
    }

    let compareDate = 0;
    if (compareMap != null && compareMap.rankDate != null) {
      compareDate = compareMap.rankDate.getTime() + DAY; // daily rank limit date

      if (i >= rankedMaps.length + RANK_PER_DAY) {
        compareDate += RANK_INTERVAL * MINUTE; // increase accuracy for maps further down in the queue
      }
    }

    qualifiedMap.rankDateEarly = new Date(
      Math.max(qualifiedMap.queueDate!.getTime(), compareDate),
    );

    qualifiedMap.probability = null;
    // don't calculate probability for maps using rounded compare date
    if (
      qualifiedMap.queueDate!.getTime() > compareDate ||
      i < rankedMaps.length + RANK_PER_DAY
    ) {
      qualifiedMap.probability = probabilityAfter(
        intervalTimeDelta(qualifiedMap.rankDateEarly),
      );
    }

    qualifiedMap.rankDate = new Date(
      roundMinutes(qualifiedMap.rankDateEarly.getTime()),
    );

    if (i - RANK_PER_RUN >= 0 && !qualifiedMap.unresolved) {
      const filteredMaps = combined.slice(0, i).filter((beatmapSet) =>
        !beatmapSet.unresolved
      ).reverse();
      // fix date for maps after the adjustment below
      if (
        filteredMaps[0].queueDate !== null &&
        qualifiedMap.rankDate.getTime() <
          roundMinutes(filteredMaps[0].rankDate!.getTime(), true)
      ) {
        qualifiedMap.rankDate = new Date(
          roundMinutes(filteredMaps[0].rankDate!.getTime(), true),
        );
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.probability = 0;
      }

      // if 3 maps have the same time, the 3rd map is pushed to next interval
      if (
        filteredMaps
          .slice(0, RANK_PER_RUN)
          .every(
            (beatmapSet) =>
              roundMinutes(beatmapSet.rankDate!.getTime(), true) >=
                roundMinutes(qualifiedMap.rankDateEarly!.getTime(), true),
          )
      ) {
        if (
          filteredMaps
            .slice(0, RANK_PER_RUN)
            .every(
              (beatmapSet) =>
                roundMinutes(beatmapSet.rankDate!.getTime(), true) ===
                  roundMinutes(
                    filteredMaps[RANK_PER_RUN - 1].rankDate!.getTime(),
                    true,
                  ),
            )
        ) {
          qualifiedMap.rankDate = new Date(
            roundMinutes(filteredMaps[0].rankDate!.getTime(), true) +
              RANK_INTERVAL * MINUTE,
          );
        } else {
          qualifiedMap.rankDate = new Date(
            roundMinutes(filteredMaps[0].rankDate!.getTime(), true),
          );
        }
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.probability = 0;
      }
    }
  }
};

export const calcEarlyProbability = (qualifiedMaps: BeatmapSet[][]) => {
  const rankDates: { [key: number]: number[] } = {};
  qualifiedMaps.forEach((beatmapSets) => {
    for (const beatmapSet of beatmapSets) {
      // assume map will be ranked early if probability > SPLIT to simplify calculations
      const key = (beatmapSet.probability ?? 0) > SPLIT
        ? roundMinutes(beatmapSet.rankDateEarly!.getTime(), true)
        : beatmapSet.rankDate!.getTime();

      if (!(key in rankDates)) {
        rankDates[key] = [0, 0, 0, 0];
      }
      rankDates[key][beatmapSet.mode] += 1;
    }
  });
  qualifiedMaps.forEach((beatmapSets) => {
    for (const beatmapSet of beatmapSets) {
      const key = roundMinutes(beatmapSet.rankDateEarly!.getTime(), true);
      if (
        beatmapSet.probability !== null &&
        beatmapSet.rankDateEarly!.getTime() !== beatmapSet.rankDate!.getTime()
      ) {
        const otherModes = rankDates[key]?.filter((_, mode) =>
          mode != beatmapSet.mode
        );
        const probability = probabilityAfter(
          intervalTimeDelta(beatmapSet.rankDateEarly!),
          otherModes,
        );
        beatmapSet.probability = probability;
      }
    }
  });
};

export const adjustAllRankDates = (
  qualifiedMaps: BeatmapSet[][],
  rankedMaps: BeatmapSet[][],
) => {
  const MODES = 4;
  for (let mode = 0; mode < MODES; mode++) {
    adjustRankDates(qualifiedMaps[mode], rankedMaps[mode]);
  }
  calcEarlyProbability(qualifiedMaps);
};

type StoredMapProperties = [number, number | null, number | null, boolean];

export const storeMapProperties = (qualifiedData: BeatmapSetDatabase[]) => {
  const previousData: { [key: number]: StoredMapProperties } = {};

  qualifiedData.forEach((beatmapSet) => {
    previousData[beatmapSet.id] = [
      beatmapSet.rank_date,
      beatmapSet.rank_date_early,
      beatmapSet.probability,
      beatmapSet.unresolved,
    ];
  });

  return previousData;
};

export const getFormattedMapsFromDatabase = async (
  supabase: SupabaseClient<Database>,
) => {
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

  const qualifiedMaps = databaseToSplitModes(
    qualifiedData.sort((a, b) => a.queue_date! - b.queue_date!),
  );
  const rankedMaps = databaseToSplitModes(
    rankedData.sort((a, b) => a.rank_date - b.rank_date),
  );

  return { qualifiedMaps, rankedMaps, qualifiedData, rankedData };
};

export const getUpdatedMaps = (
  qualifiedMaps: BeatmapSet[][],
  previousData: { [key: number]: StoredMapProperties },
) => {
  const mapsToUpdate: BeatmapSetDatabase[] = [];
  const updatedMapIds: number[] = [];

  qualifiedMaps.forEach((beatmapSets) => {
    beatmapSets.forEach((beatmapSet) => {
      const currentData: StoredMapProperties = [
        beatmapSet.rankDate!.getTime() / 1000,
        beatmapSet.rankDateEarly!.getTime() / 1000,
        beatmapSet.probability,
        beatmapSet.unresolved,
      ];

      // if rankDate/rankDateEarly/probability has changed or new qualified map
      if (
        !(beatmapSet.id in previousData) ||
        previousData[beatmapSet.id].reduce(
          (updated, value, i) => updated || currentData[i] !== value,
          false,
        )
      ) {
        mapsToUpdate.push(beatmapSetToDatabase(beatmapSet));
        updatedMapIds.push(beatmapSet.id);
      }
    });
  });

  return { mapsToUpdate, updatedMapIds };
};

//#endregion
