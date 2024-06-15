import { BeatmapSet } from "./beatmap.types";
import { RANK_INTERVAL, RANK_PER_DAY, RANK_PER_RUN, SPLIT } from "./config";
import { DAY, MINUTE } from "./timeConstants";
import { probabilityAfter } from "./utils/probability";

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
    const compareMap = combined[i - RANK_PER_DAY];

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
      prev?.getTime() !== qualifiedMap.rankDateEarly.getTime() ||
      qualifiedMap.id === 2106498
    ) {
      console.log(qualifiedMap.id, "-", prev, qualifiedMap.rankDateEarly);
      console.log(qualifiedMap.id, "- compareDate:", new Date(compareDate));
      if (compareMap != null && compareMap.rankDate != null) {
        console.log(
          qualifiedMap.id,
          "- compareMap.rankDate:",
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
      // fix date for maps after the adjustment below
      if (
        combined[i - 1].queueDate !== null &&
        qualifiedMap.rankDate.getTime() <
          roundMinutes(combined[i - 1].rankDate!.getTime(), true)
      ) {
        qualifiedMap.rankDate = new Date(
          roundMinutes(combined[i - 1].rankDate!.getTime(), true),
        );
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.probability = 0;
      }

      // if 3 maps have the same time, the 3rd map is pushed to next interval
      if (
        combined
          .slice(i - RANK_PER_RUN, i)
          .every(
            (beatmapSet) =>
              roundMinutes(beatmapSet.rankDate!.getTime(), true) >=
                roundMinutes(qualifiedMap.rankDateEarly!.getTime(), true),
          )
      ) {
        if (
          combined
            .slice(i - RANK_PER_RUN, i)
            .every(
              (beatmapSet) =>
                roundMinutes(beatmapSet.rankDate!.getTime(), true) ===
                  roundMinutes(
                    combined[i - RANK_PER_RUN].rankDate!.getTime(),
                    true,
                  ),
            )
        ) {
          qualifiedMap.rankDate = new Date(
            roundMinutes(combined[i - 1].rankDate!.getTime(), true) +
              RANK_INTERVAL * MINUTE,
          );
        } else {
          qualifiedMap.rankDate = new Date(
            roundMinutes(combined[i - 1].rankDate!.getTime(), true),
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
