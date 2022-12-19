const axios = require("axios");
const { BeatmapSet, MapEvent } = require("./beatmap");
const { DAY } = require("./utils/timeConstants");

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
      `https://osu.ppy.sh/api/v2/beatmapsets/search?m=0&s=qualified&sort=ranked_asc&nsfw=true&page=${page}`,
      accessToken
    );

    dataList.push(...data.beatmapsets);
    if (data.beatmapsets.length < 50) break;
    page++;
  }

  const qualifiedMaps = [];
  for (const item of dataList) {
    const beatmapSet = new BeatmapSet(item);

    await beatmapSet.getQueueTime();

    qualifiedMaps.push(beatmapSet);
  }

  return qualifiedMaps;
};

const getRankedMaps = async (accessToken) => {
  const data = await axiosGet(
    `https://osu.ppy.sh/api/v2/beatmapsets/search?m=0&s=ranked&nsfw=true&q=ranked>${Math.floor(
      (Date.now() - DAY) / 1000
    )}`,
    accessToken
  );
  return data.beatmapsets.map((beatmapSet) => new BeatmapSet(beatmapSet)).reverse();
  // data.beatmapsets.forEach(beatmapSet => {
  //   // separate into different modes
  // })
};

const getEventsAfter = async (accessToken, lastEventId) => {
  let page = 1;
  let apiCalls = 0;
  const newEvents = [];
  const newEventIds = [];
  let newLastEventId;
  while (true) {
    const data = await axiosGet(
      `https://osu.ppy.sh/api/v2/beatmapsets/events?types[]=qualify&types[]=rank&types[]=disqualify&limit=5&page=${page}`,
      accessToken
    );
    newLastEventId ??= data.events[0].id;
    apiCalls++;
    for (const event of data.events) {
      if (event.id == lastEventId) return [newEvents.reverse(), newLastEventId];

      // skip duplicates caused by timeout
      if (newEventIds.includes(event.id)) continue;

      if (event.type == "qualify") {
        // use api v1 to decrease data usage (~30KB for v2 vs ~2KB for v1)
        const data = await axiosGet(
          `https://osu.ppy.sh/api/get_beatmaps?k=${process.env.API_KEY}&m=0&s=${event.beatmapset.id}&limit=1`
        );
        if (data.length > 0) newEvents.push(new MapEvent(event));

        // api v2
        // const data = await axiosGet(
        //   `https://osu.ppy.sh/api/v2/beatmapsets/${event.beatmapset.id}`,
        //   accessToken
        // );
        // if (data.beatmaps.filter((beatmap) => beatmap.mode === "osu").length > 0)
        //   newEvents.push(new MapEvent(event));
      } else {
        newEvents.push(new MapEvent(event));
      }

      apiCalls++;

      newEventIds.push(event.id);
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
