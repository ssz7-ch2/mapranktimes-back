const { getRankedMaps, getBeatmapSet, getEventsAfter } = require("./osuRequests");
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

    if (i - config.RANK_PER_RUN >= 0) {
      // fix date for maps after the adjustment below
      if (qualifiedMap.rankDate < combined[i - 1].rankDate) {
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
        qualifiedMap.rankDate = new Date(
          roundMinutes(combined[i - 1].rankDate.getTime(), true) + config.RANK_INTERVAL * MINUTE
        );
        qualifiedMap.rankDateEarly = qualifiedMap.rankDate;
        qualifiedMap.rankEarly = false;
        qualifiedMap.probability = 0;
      }
    }
  }
};

const calcEarlyProbability = (qualifiedMaps, limit = null) => {
  const rankDates = {};
  qualifiedMaps.forEach((beatmapSets) => {
    for (let i = 0; i < Math.min(limit || beatmapSets.length, beatmapSets.length); i++) {
      // assume map will be ranked early if probability > SPLIT to simplify calculations
      const key =
        beatmapSets[i].probability > config.SPLIT
          ? roundMinutes(beatmapSets[i].rankDateEarly.getTime(), true)
          : beatmapSets[i].rankDate.getTime();
      if (!(key in rankDates)) {
        rankDates[key] = [0, 0, 0, 0];
      }
      rankDates[key][beatmapSets[i].mode] += 1;
    }
  });

  let changed = false;
  qualifiedMaps.forEach((beatmapSets) => {
    for (let i = 0; i < Math.min(limit || beatmapSets.length, beatmapSets.length); i++) {
      if (
        beatmapSets[i].probability !== null &&
        beatmapSets[i].rankDateEarly.getTime() !== beatmapSets[i].rankDate.getTime()
      ) {
        const key = roundMinutes(beatmapSets[i].rankDateEarly.getTime(), true);
        const otherModes = rankDates[key]?.filter((_, mode) => mode != beatmapSets[i].mode);
        const probability = probabilityAfter(
          intervalTimeDelta(beatmapSets[i].rankDateEarly),
          otherModes
        );
        if (beatmapSets[i].probability !== probability) changed = true;
        beatmapSets[i].probability = probability;
      }
      beatmapSets[i].rankEarly = beatmapSets[i].probability >= 0.01; // about the same as >= 6min 6s
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

const rankEvent = async (qualifiedMaps, rankedMaps, accessToken, mapEvent) => {
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
    rankedMaps.concat(updatedRankedMaps);
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
    rankedMaps[beatmapSetTarget.mode].push(beatmapSetTarget);
    if (rankedMaps[beatmapSetTarget.mode].length > config.RANK_PER_DAY)
      rankedMaps[beatmapSetTarget.mode].shift(); // only keep necessary maps

    // TODO: could be more efficient
    adjustRankDates(qualifiedMaps[beatmapSetTarget.mode], rankedMaps[beatmapSetTarget.mode], start);
  }
};

const qualifyEvent = async (qualifiedMaps, rankedMaps, accessToken, mapEvent) => {
  const newBeatmapSet = await getBeatmapSet(accessToken, mapEvent.beatmapSetId);

  // reverse order since usually new qualified maps are added near the end of list
  let i = qualifiedMaps[newBeatmapSet.mode].length;
  for (; i > 0; i--) {
    if (newBeatmapSet.queueDate >= qualifiedMaps[newBeatmapSet.mode][i - 1].queueDate) {
      qualifiedMaps[newBeatmapSet.mode].splice(i, 0, newBeatmapSet);
      break;
    }
  }

  adjustRankDates(qualifiedMaps[newBeatmapSet.mode], rankedMaps[newBeatmapSet.mode], i);
};

const disqualifyEvent = (qualifiedMaps, rankedMaps, mapEvent) => {
  const [beatmapSetTarget, start] = removeMapFromQualified(qualifiedMaps, mapEvent);

  if (beatmapSetTarget == null) return;

  adjustRankDates(qualifiedMaps[beatmapSetTarget.mode], rankedMaps[beatmapSetTarget.mode], start);
};

const checkEvents = async (appData, limit = 5) => {
  let [newEvents, newLastEventId] = await getEventsAfter(
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
        await rankEvent(appData.qualifiedMaps, appData.rankedMaps, appData.accessToken, mapEvent);
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
  return newEvents;
};

// used when loading beatmapSets from JSON file intead of api
const JSONToBeatmapSets = (beatmapSetsJSON) => {
  beatmapSetsJSON.forEach((beatmapSet) => {
    if (beatmapSet.queueDate) beatmapSet.queueDate = new Date(beatmapSet.queueDate);
    if (beatmapSet.rankDate) beatmapSet.rankDate = new Date(beatmapSet.rankDate);
    if (beatmapSet.rankDateEarly) beatmapSet.rankDateEarly = new Date(beatmapSet.rankDateEarly);
  });
};

const reduceQualifiedMaps = (qualifiedMaps) =>
  qualifiedMaps
    .flat()
    .sort((a, b) => a.rankDateEarly - b.rankDateEarly)
    .map((beatmapSet) => BeatmapSet.reduced(beatmapSet));

module.exports.adjustAllRankDates = adjustAllRankDates;
module.exports.checkEvents = checkEvents;
module.exports.JSONToBeatmapSets = JSONToBeatmapSets;
module.exports.reduceQualifiedMaps = reduceQualifiedMaps;
module.exports.calcEarlyProbability = calcEarlyProbability;
