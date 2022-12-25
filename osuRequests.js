const axios = require("axios");
const { BeatmapSet, MapEvent } = require("./beatmap");
const { DAY, MINUTE } = require("./utils/timeConstants");

require("dotenv").config();

const axiosGet = async (url, accessToken) => {
  const { data } = await axios.get(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });
  return data;
};

const getAccessToken = async () => {
  let body = {
    client_id: process.env.CLIENT_ID,
    client_secret: process.env.CLIENT_SECRET,
    grant_type: "client_credentials",
    scope: "public",
  };

  const { data } = await axios.post("https://osu.ppy.sh/oauth/token", body, {
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
  });

  return [data.access_token, Date.now() + (data.expires_in - 600) * 1000];
};

const getBeatmapSet = async (accessToken, beatmapSetId) => {
  const data = await axiosGet(`https://osu.ppy.sh/api/v2/beatmapsets/${beatmapSetId}`, accessToken);

  const beatmapSet = new BeatmapSet(data);
  if (data.status === "qualified") {
    await beatmapSet.getQueueTime();
  }

  return beatmapSet;
};

const getQualifiedMaps = async (accessToken) => {
  const dataList = [];
  let page = 1;
  while (true) {
    const data = await axiosGet(
      `https://osu.ppy.sh/api/v2/beatmapsets/search?s=qualified&sort=ranked_asc&nsfw=true&page=${page}`,
      accessToken
    );

    dataList.push(...data.beatmapsets);
    if (data.beatmapsets.length < 50) break;
    page++;
  }
  if (process.env.DEVELOPMENT && process.env.MAPS_COUNT) {
    dataList.splice(parseInt(process.env.MAPS_COUNT));
  }

  const qualifiedMaps = [[], [], [], []];
  for (const item of dataList) {
    const beatmapSet = new BeatmapSet(item);

    await beatmapSet.getQueueTime();

    qualifiedMaps[beatmapSet.mode].push(beatmapSet);
  }

  return qualifiedMaps;
};

const getRankedMaps = async (accessToken) => {
  // one request since it's highly unlikely that more than 50 maps are ranked in one day
  const data = await axiosGet(
    `https://osu.ppy.sh/api/v2/beatmapsets/search?s=ranked&nsfw=true&q=ranked>${Math.floor(
      (Date.now() - (DAY + 60 * MINUTE)) / 1000
    )}`,
    accessToken
  );

  // splitting into modes is easier to manage
  const rankedMaps = [[], [], [], []];
  data.beatmapsets.reverse().forEach((beatmapSetData) => {
    const beatmapSet = new BeatmapSet(beatmapSetData);
    rankedMaps[beatmapSet.mode].push(beatmapSet);
  });
  return rankedMaps;
};

const getEventsAfter = async (accessToken, lastEventId, limit = 5) => {
  let page = 1;
  let apiCalls = 0;
  const newEvents = [];
  const newEventIds = [];
  let newLastEventId;

  while (true) {
    const data = await axiosGet(
      `https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=rank&types[]=disqualify&limit=${limit}&page=${page}`,
      accessToken
    );
    newLastEventId ??= data.events[0].id;
    apiCalls++;
    for (const event of data.events) {
      if (event.id == lastEventId) return [newEvents.reverse(), newLastEventId];

      // skip duplicates caused by timeout
      if (newEventIds.includes(event.id)) continue;

      newEvents.push(new MapEvent(event));
      newEventIds.push(event.id);
      apiCalls++;
    }
    if (apiCalls > 40) {
      await new Promise((resolve) => setTimeout(resolve, 60000));
      apiCalls = 0;
    }
    page++;
  }
};

const getLatestEvent = async (accessToken) => {
  const data = await axiosGet(
    "https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=rank&types[]=disqualify&limit=5",
    accessToken
  );
  return data.events[0].id;
};

module.exports.getAccessToken = getAccessToken;
module.exports.getBeatmapSet = getBeatmapSet;
module.exports.getQualifiedMaps = getQualifiedMaps;
module.exports.getRankedMaps = getRankedMaps;
module.exports.getEventsAfter = getEventsAfter;
module.exports.getLatestEvent = getLatestEvent;
