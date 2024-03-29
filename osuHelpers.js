const {
  getRankedMaps,
  getBeatmapSet,
  getEventsAfter,
  getRankedMapsFull,
} = require("./osuRequests");
const { BeatmapSet } = require("./beatmap");
const config = require("./config");
const { MINUTE, DAY } = require("./utils/timeConstants");
const { probabilityAfter } = require("./utils/probability");

// round milliseconds up or down to rank intervals and return new date
const roundMinutes = (milliseconds, down = false) =>
  (down
    ? Math.floor(milliseconds / (config.RANK_INTERVAL * MINUTE))
    : Math.ceil(milliseconds / (config.RANK_INTERVAL * MINUTE))) *
  (config.RANK_INTERVAL * MINUTE);

// time from previous interval in seconds
const intervalTimeDelta = (date) => (date.getUTCMinutes() % 20) * 60 + date.getSeconds();

const adjustRankDates = (qualifiedMaps, rankedMaps, start = 0) => {
  const combined = rankedMaps.concat(qualifiedMaps);
  for (let i = rankedMaps.length + start; i < combined.length; i++) {
    const qualifiedMap = combined[i];

    let compareDate = combined[i - config.RANK_PER_DAY]?.rankDate.getTime() + DAY; // daily rank limit date

    if (isNaN(compareDate))
      compareDate = 0; // compareDate == NaN means that queueDate > rank limit date
    else if (i >= rankedMaps.length + config.RANK_PER_DAY)
      compareDate += config.RANK_INTERVAL * MINUTE; // increase accuracy for maps further down in the queue

    qualifiedMap.rankDateEarly = new Date(Math.max(qualifiedMap.queueDate.getTime(), compareDate)); // unrounded rankDate

    // don't calculate probability for maps using rounded compare date
    qualifiedMap.probability = null;
    if (
      qualifiedMap.queueDate.getTime() > compareDate ||
      i < rankedMaps.length + config.RANK_PER_DAY
    ) {
      qualifiedMap.probability = probabilityAfter(intervalTimeDelta(qualifiedMap.rankDateEarly));
    }

    qualifiedMap.rankEarly = qualifiedMap.probability >= 0.01; // about the same as >= 6min 6s
    qualifiedMap.rankDate = new Date(roundMinutes(qualifiedMap.rankDateEarly.getTime()));

    if (i - config.RANK_PER_RUN >= 0 && !qualifiedMap.unresolved) {
      // fix date for maps after the adjustment below
      if (
        combined[i - 1].queueDate !== null &&
        qualifiedMap.rankDate.getTime() < roundMinutes(combined[i - 1].rankDate.getTime(), true)
      ) {
        qualifiedMap.rankDate = new Date(roundMinutes(combined[i - 1].rankDate.getTime(), true));
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.rankEarly = false;
        qualifiedMap.probability = 0;
      }

      // if 3 maps have the same time, the 3rd map is pushed to next interval
      if (
        combined
          .slice(i - config.RANK_PER_RUN, i)
          .every(
            (beatmapSet) =>
              roundMinutes(beatmapSet.rankDate.getTime(), true) >=
              roundMinutes(qualifiedMap.rankDateEarly.getTime(), true)
          )
      ) {
        if (
          combined
            .slice(i - config.RANK_PER_RUN, i)
            .every(
              (beatmapSet) =>
                roundMinutes(beatmapSet.rankDate.getTime(), true) ===
                roundMinutes(combined[i - config.RANK_PER_RUN].rankDate.getTime(), true)
            )
        ) {
          qualifiedMap.rankDate = new Date(
            roundMinutes(combined[i - 1].rankDate.getTime(), true) + config.RANK_INTERVAL * MINUTE
          );
        } else {
          qualifiedMap.rankDate = new Date(roundMinutes(combined[i - 1].rankDate.getTime(), true));
        }
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.rankEarly = false;
        qualifiedMap.probability = 0;
      }
    }
  }
};

const calcEarlyProbability = (qualifiedMaps, limit = Number.MAX_VALUE) => {
  const rankDates = {};
  qualifiedMaps.forEach((beatmapSets) => {
    for (const beatmapSet of beatmapSets) {
      // assume map will be ranked early if probability > SPLIT to simplify calculations
      const key =
        beatmapSet.probability > config.SPLIT
          ? roundMinutes(beatmapSet.rankDateEarly.getTime(), true)
          : beatmapSet.rankDate.getTime();
      if (key > limit) break;
      if (!(key in rankDates)) {
        rankDates[key] = [0, 0, 0, 0];
      }
      rankDates[key][beatmapSet.mode] += 1;
    }
  });

  let changed = false;
  qualifiedMaps.forEach((beatmapSets) => {
    for (const beatmapSet of beatmapSets) {
      const key = roundMinutes(beatmapSet.rankDateEarly.getTime(), true);
      if (key > limit) break;
      if (
        beatmapSet.probability !== null &&
        beatmapSet.rankDateEarly.getTime() !== beatmapSet.rankDate.getTime()
      ) {
        const otherModes = rankDates[key]?.filter((_, mode) => mode != beatmapSet.mode);
        const probability = probabilityAfter(
          intervalTimeDelta(beatmapSet.rankDateEarly),
          otherModes
        );
        if (beatmapSet.probability.toFixed(4) != probability.toFixed(4)) changed = true;
        beatmapSet.probability = probability;
      }
      beatmapSet.rankEarly = beatmapSet.probability >= 0.01; // about the same as >= 6min 6s
    }
  });
  return changed;
};

const adjustAllRankDates = (qualifiedMaps, rankedMaps) => {
  const MODES = 4;
  for (let mode = 0; mode < MODES; mode++) adjustRankDates(qualifiedMaps[mode], rankedMaps[mode]);
  calcEarlyProbability(qualifiedMaps);
};

// find map in qualifiedMaps, then remove and return the map and its index
// returns empty list if map not found
const removeMapFromQualified = (qualifiedMaps, mapEvent) => {
  // have to loop through all since mapEvent has no mode info :(
  for (const beatmapSets of qualifiedMaps) {
    for (let i = 0; i < beatmapSets.length; i++) {
      if (beatmapSets[i].id == mapEvent.beatmapSetId) return [beatmapSets.splice(i, 1)[0], i];
    }
  }
  return [];
};

const rankEvent = async (qualifiedMaps, rankedMaps, rankedMapsFull, accessToken, mapEvent) => {
  // in case ranked out of order? can this even happen idk
  const [beatmapSetTarget, start] = removeMapFromQualified(qualifiedMaps, mapEvent);

  // in case rank event was already processed
  if (beatmapSetTarget == null) {
    console.log(
      new Date().toISOString(),
      `- new ${mapEvent.type} event for beatmapset ${
        mapEvent.beatmapSetId
      } at ${mapEvent.createdAt.toISOString()}`
    );
    rankedMaps.splice(0, rankedMaps.length);
    const updatedRankedMaps = await getRankedMaps(accessToken);
    rankedMaps.push(...updatedRankedMaps);

    rankedMapsFull.splice(0, rankedMapsFull.length);
    const updatedRankedMapsFull = await getRankedMapsFull(accessToken);
    rankedMapsFull.push(...updatedRankedMapsFull);

    adjustAllRankDates(qualifiedMaps, rankedMaps);
  } else {
    console.log(
      new Date().toISOString(),
      `- new ${mapEvent.type} event for beatmapset ${
        mapEvent.beatmapSetId
      } at ${mapEvent.createdAt.toISOString()}${
        mapEvent.type == "rank"
          ? ` (calculated ${beatmapSetTarget.rankDate.toISOString()}, ${beatmapSetTarget.rankDateEarly.toISOString()}, ${
              beatmapSetTarget.probability
            })`
          : ""
      }`
    );
    beatmapSetTarget.rankDate = mapEvent.createdAt;
    beatmapSetTarget.queueDate = null;
    beatmapSetTarget.probability = 0;
    beatmapSetTarget.unresolved = false;
    rankedMaps[beatmapSetTarget.mode].push(beatmapSetTarget);
    rankedMapsFull[beatmapSetTarget.mode].push(beatmapSetTarget);

    if (rankedMaps[beatmapSetTarget.mode].length > config.RANK_PER_DAY)
      rankedMaps[beatmapSetTarget.mode].shift(); // only keep necessary maps
    if (rankedMapsFull[beatmapSetTarget.mode].length > config.RANKED_MAPS_LIMIT)
      rankedMapsFull[beatmapSetTarget.mode].shift(); // only keep necessary maps

    // TODO: could be more efficient
    adjustRankDates(qualifiedMaps[beatmapSetTarget.mode], rankedMaps[beatmapSetTarget.mode], start);
  }
};

const qualifyEvent = async (qualifiedMaps, rankedMaps, accessToken, mapEvent) => {
  const newBeatmapSet = await getBeatmapSet(accessToken, mapEvent.beatmapSetId);

  // reverse order since usually new qualified maps are added near the end of list
  let i = qualifiedMaps[newBeatmapSet.mode].length;
  if (i === 0) {
    qualifiedMaps[newBeatmapSet.mode].push(newBeatmapSet);
  } else {
    for (; i > 0; i--) {
      if (newBeatmapSet.queueDate >= qualifiedMaps[newBeatmapSet.mode][i - 1].queueDate) {
        qualifiedMaps[newBeatmapSet.mode].splice(i, 0, newBeatmapSet);
        break;
      }
    }
  }

  adjustRankDates(qualifiedMaps[newBeatmapSet.mode], rankedMaps[newBeatmapSet.mode], i);
};

const disqualifyEvent = (qualifiedMaps, rankedMaps, mapEvent) => {
  const [beatmapSetTarget, start] = removeMapFromQualified(qualifiedMaps, mapEvent);

  if (beatmapSetTarget == null) return;

  adjustRankDates(qualifiedMaps[beatmapSetTarget.mode], rankedMaps[beatmapSetTarget.mode], start);
};

let running = false;

const checkEvents = async (appData, limit = 5) => {
  // prevent concurrent checkEvents from running
  while (running) await new Promise((resolve) => setTimeout(resolve, 500));
  running = true;
  let newEvents = [];
  try {
    let newLastEventId;
    [newEvents, newLastEventId] = await getEventsAfter(
      appData.accessToken,
      appData.lastEventId,
      limit
    );

    for (const mapEvent of newEvents) {
      if (mapEvent.type != "rank")
        console.log(
          new Date().toISOString(),
          `- new ${mapEvent.type} event for beatmapset ${
            mapEvent.beatmapSetId
          } at ${mapEvent.createdAt.toISOString()}`
        );
      switch (mapEvent.type) {
        case "rank":
          await rankEvent(
            appData.qualifiedMaps,
            appData.rankedMaps,
            appData.rankedMapsFull,
            appData.accessToken,
            mapEvent
          );
          appData.lastEventId = mapEvent.id;
          break;
        case "qualify":
          await qualifyEvent(
            appData.qualifiedMaps,
            appData.rankedMaps,
            appData.accessToken,
            mapEvent
          );
          break;
        case "disqualify":
          disqualifyEvent(appData.qualifiedMaps, appData.rankedMaps, mapEvent);
          break;
        default:
          break;
      }
      // in case of errors, only update to latest completed event
      appData.lastEventId = mapEvent.id;
    }
    if (newEvents.length > 0) calcEarlyProbability(appData.qualifiedMaps);

    // if (newEvents.length === 0) console.log(new Date().toISOString(), "- no new events");

    appData.lastEventId = newLastEventId;
  } finally {
    running = false;
  }
  return newEvents;
};

// used when loading beatmapSets from JSON file intead of api
const JSONToBeatmapSet = (beatmapSetJSON) => {
  if (beatmapSetJSON.queueDate) beatmapSetJSON.queueDate = new Date(beatmapSetJSON.queueDate);
  if (beatmapSetJSON.rankDate) beatmapSetJSON.rankDate = new Date(beatmapSetJSON.rankDate);
  if (beatmapSetJSON.rankDateEarly)
    beatmapSetJSON.rankDateEarly = new Date(beatmapSetJSON.rankDateEarly);
  let newBeatmapSet = new BeatmapSet({});
  Object.assign(newBeatmapSet, beatmapSetJSON);
  return newBeatmapSet;
};

const reduceQualifiedMaps = (qualifiedMaps) =>
  qualifiedMaps
    .flat()
    .sort((a, b) => a.rankDateEarly - b.rankDateEarly)
    .map((beatmapSet) => BeatmapSet.reduced(beatmapSet));

const reduceRankedMaps = (rankedMaps) =>
  rankedMaps
    .flat()
    .sort((a, b) => b.rankDate - a.rankDate)
    .map((beatmapSet) => BeatmapSet.reduced(beatmapSet));

module.exports.adjustAllRankDates = adjustAllRankDates;
module.exports.checkEvents = checkEvents;
module.exports.JSONToBeatmapSet = JSONToBeatmapSet;
module.exports.reduceQualifiedMaps = reduceQualifiedMaps;
module.exports.reduceRankedMaps = reduceRankedMaps;
module.exports.calcEarlyProbability = calcEarlyProbability;
