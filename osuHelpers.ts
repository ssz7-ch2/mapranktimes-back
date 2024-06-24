import { SupabaseClient } from "@supabase/supabase-js";
import { BeatmapSet, BeatmapSetDatabase } from "./beatmap.types";
import { RANK_INTERVAL, RANK_PER_DAY, RANK_PER_RUN, SPLIT } from "./config";
import { DAY, HOUR, MINUTE } from "./timeConstants";
import { beatmapSetToDatabase, databaseToSplitModes } from "./utils";
import { probabilityAfter } from "./utils/probability";
import { Database } from "./database.types";

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
  const combined = rankedMaps.concat(qualifiedMaps);
  for (let i = rankedMaps.length + start; i < combined.length; i++) {
    const qualifiedMap = combined[i];

    let compareMap: BeatmapSet | null = null;

    // skip over unresolved maps
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

    const prev = qualifiedMap.rankDateEarly;

    qualifiedMap.rankDateEarly = new Date(
      Math.max(qualifiedMap.queueDate!.getTime(), compareDate),
    );

    if (
      prev?.getTime() !== qualifiedMap.rankDateEarly.getTime()
    ) {
      console.log(qualifiedMap.id, "-", prev, qualifiedMap.rankDateEarly);
      console.log(qualifiedMap.id, "- queueDate:", qualifiedMap.queueDate);
      console.log(qualifiedMap.id, "- compareDate:", new Date(compareDate));
      if (compareMap != null && compareMap.rankDate != null) {
        console.log(
          qualifiedMap.id,
          `- compareMap.rankDate ${compareMap.id}:`,
          compareMap.rankDate,
        );
      } else {
        console.log(i - RANK_PER_DAY, rankedMaps.length);
      }
    }

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
      const key = beatmapSet.probability ?? 0 > SPLIT
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
