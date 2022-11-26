const { getRankedMaps, getBeatmapSet, getEventsAfter } = require("./osuRequests");
const config = require("./config");
const { MINUTE, DAY } = require("./utils/timeConstants");
const { probabilityAfter } = require("./utils/probability");

// round milliseconds up to rank intervals and return new date
const roundMinutes = (milliseconds) =>
  new Date(
    Math.ceil(milliseconds / (config.RANK_INTERVAL * MINUTE)) * (config.RANK_INTERVAL * MINUTE)
  );

const adjustRankDates = (qualifiedMaps, rankedMaps, start = 0) => {
  const combined = [...rankedMaps, ...qualifiedMaps];
  for (let i = rankedMaps.length + start; i < combined.length; i++) {
    const qualifiedMap = combined[i];

    let compareDate = combined[i - config.RANK_PER_DAY]?.rankDate.getTime() + DAY; // daily rank limit date

    if (isNaN(compareDate))
      compareDate = 0; // compareDate = NaN means that queueDate > rank limit date
    else if (i >= rankedMaps.length + config.RANK_PER_DAY)
      compareDate += config.RANK_INTERVAL * MINUTE; // increase accuracy for maps further down in the queue

    qualifiedMap.rankDateEarly = new Date(Math.max(qualifiedMap.queueDate.getTime(), compareDate)); // unrounded rankDate

    // don't calculate probability for maps using rounded compare date
    if (
      qualifiedMap.queueDate.getTime() > compareDate ||
      i < rankedMaps.length + config.RANK_PER_DAY
    ) {
      qualifiedMap.probability = probabilityAfter(
        (qualifiedMap.rankDateEarly.getUTCMinutes() % 20) * 60 +
          qualifiedMap.rankDateEarly.getSeconds()
      );
    }

    qualifiedMap.rankEarly = qualifiedMap.probability >= 0.01; // about the same as >= 6min 6s

    qualifiedMap.rankDate = roundMinutes(qualifiedMap.rankDateEarly.getTime());

    if (i - rankedMaps.length >= config.RANK_PER_RUN) {
      // fix date for maps after the adjustment below
      if (qualifiedMap.rankDate < combined[i - 1].rankDate)
        qualifiedMap.rankDate = combined[i - 1].rankDate;

      // if 3 maps have the same time, the 3rd map is pushed to next interval
      if (
        combined
          .slice(i - config.RANK_PER_RUN, i)
          .every((beatmapSet) => beatmapSet.rankDate.getTime() === qualifiedMap.rankDate.getTime())
      )
        qualifiedMap.rankDate = new Date(
          qualifiedMap.rankDate.getTime() + config.RANK_INTERVAL * MINUTE
        );
    }
  }
};

const adjustAllRankDates = ({ qualifiedMaps, rankedMaps }) => {
  // for each mode
};

// find map in qualifiedMaps, then remove and return the map and its index
// returns empty list if map not found
const removeMapFromQualified = (qualifiedMaps, mapEvent) => {
  for (let i = 0; i < qualifiedMaps.length; i++) {
    if (qualifiedMaps[i].id == mapEvent.beatmapSetId) return [qualifiedMaps.splice(i, 1)[0], i];
  }
  return [];
};

const rankEvent = async (qualifiedMaps, rankedMaps, accessToken, mapEvent) => {
  // in case ranked out of order? can this even happen idk
  const [beatmapSetTarget, start] = removeMapFromQualified(qualifiedMaps, mapEvent);

  // in case rank event was already processed
  if (beatmapSetTarget == null) {
    rankedMaps = await getRankedMaps(accessToken);
  } else {
    beatmapSetTarget.rankDate = mapEvent.createdAt;
    rankedMaps.push(beatmapSetTarget);
    if (rankedMaps.length > config.RANK_PER_DAY) rankedMaps.shift(); // only keep necessary maps
  }

  // TODO: could be more efficient
  adjustRankDates(qualifiedMaps, rankedMaps, start);
};

const qualifyEvent = async (qualifiedMaps, rankedMaps, accessToken, mapEvent) => {
  const newBeatmapSet = await getBeatmapSet(accessToken, mapEvent.beatmapSetId);

  // reverse order since usually new qualified maps are added near the end of list
  let i = qualifiedMaps.length;
  for (; i > 0; i--) {
    if (newBeatmapSet.queueDate >= qualifiedMaps[i - 1].queueDate) {
      qualifiedMaps.splice(i, 0, newBeatmapSet);
      break;
    }
  }

  adjustRankDates(qualifiedMaps, rankedMaps, i);
};

const disqualifyEvent = (qualifiedMaps, rankedMaps, mapEvent) => {
  const [beatmapSetTarget, start] = removeMapFromQualified(qualifiedMaps, mapEvent);

  if (beatmapSetTarget == null) return;

  adjustRankDates(qualifiedMaps, rankedMaps, start);
};

const checkEvents = async (appData) => {
  let [newEvents, newLastEventId] = await getEventsAfter(appData.accessToken, appData.lastEventId);

  // remove other gamemode events
  newEvents = newEvents.filter(
    (mapEvent) =>
      mapEvent.type == "qualify" ||
      appData.qualifiedMaps.some((beatmapSet) => beatmapSet.id == mapEvent.beatmapSetId)
  );

  for (const mapEvent of newEvents) {
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
  return beatmapSetsJSON;
};

module.exports.adjustRankDates = adjustRankDates;
module.exports.checkEvents = checkEvents;
module.exports.JSONToBeatmapSets = JSONToBeatmapSets;
