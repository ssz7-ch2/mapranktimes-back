const express = require("express");
const {
  getAccessToken,
  getLatestEvent,
  getRankedMaps,
  getQualifiedMaps,
  getRankedMapsFull,
} = require("./osuRequests");
const app = express();
const cors = require("cors");
const schedule = require("node-schedule");
const {
  adjustAllRankDates,
  checkEvents,
  reduceQualifiedMaps,
  calcEarlyProbability,
  reduceRankedMaps,
} = require("./osuHelpers");
const { loadAppData, saveAppData } = require("./storage");
const config = require("./config");
const { MINUTE } = require("./utils/timeConstants");
const { debounce } = require("lodash");

app.use(cors());
app.use(express.static("public"));

require("dotenv").config();

const PORT = process.env.PORT || 5000;
let clients = [];

const appData = {
  accessToken: null,
  expireDate: null,
  lastEventId: null,
  rankedMaps: [[], [], [], []],
  rankedMapsFull: [[], [], [], []],
  qualifiedMaps: [[], [], [], []],
};

let rankQueue = [];

//#region SETUP & CRONJOB

const setToken = async () => {
  [appData.accessToken, appData.expireDate] = await getAccessToken();
  console.log(
    new Date().toISOString(),
    `- new accessToken (expires ${new Date(appData.expireDate).toISOString()})`
  );
};

const sendData = () => {
  console.log(new Date().toISOString(), "- sending data to client");
  clients.forEach((client) =>
    client.res.write(`data: ${JSON.stringify(reduceQualifiedMaps(appData.qualifiedMaps))}\n\n`)
  );
};

//#region CRONJOB functions

// return true if setIntervalRep should stop running
const _sendEvent = async () => {
  if (appData.accessToken === null || Date.now() >= appData.expireDate) {
    await setToken();
  }

  let newEvents = [];
  try {
    newEvents = await checkEvents(appData);
  } catch (error) {
    console.log(new Date().toISOString(), "- failed to get new events");
    console.log(error);
    // stop interval on error
    return true;
  }

  if (newEvents.length === 0) return rankQueue.length === 0;

  sendData();

  // remove from queue if map is ranked
  rankQueue = rankQueue.filter((queueSet) =>
    appData.qualifiedMaps[queueSet.mode].some((beatmapSet) => beatmapSet.id == queueSet.id)
  );
  return rankQueue.length === 0;
};
const sendEvent = debounce(_sendEvent, 1000);

const setIntervalRep = async (callback, interval, repeats, count = 0) => {
  const endInterval = await callback();

  if (++count >= repeats || endInterval) return;

  await new Promise((resolve) => setTimeout(resolve, interval));
  setIntervalRep(callback, interval, repeats, count);
};

//#endregion CRONJOB functions

const initialRun = async () => {
  await setToken();
  appData.lastEventId = await getLatestEvent(appData.accessToken);

  appData.rankedMaps = await getRankedMaps(appData.accessToken);
  console.log(new Date().toISOString(), "- finished getting rankedMaps");
  appData.rankedMapsFull = await getRankedMapsFull(appData.accessToken);
  console.log(new Date().toISOString(), "- finished getting rankedMapsFull");

  appData.qualifiedMaps = await getQualifiedMaps(appData.accessToken);
  console.log(new Date().toISOString(), "- finished getting qualifiedMaps");
  adjustAllRankDates(appData.qualifiedMaps, appData.rankedMaps);
  console.log(new Date().toISOString(), "- finished adjusting rank times");
};

// set up appData
const setUp = async () => {
  if (process.env.RESET_DATA) {
    await initialRun();
    if (process.env.RESET_STORE) await saveAppData(appData);
  } else {
    const error = await loadAppData(appData, async () => {
      if (appData.accessToken === null || Date.now() >= appData.expireDate) {
        await setToken();
      }
      if (appData.rankedMapsFull == null) {
        appData.rankedMapsFull = [[], [], [], []];
        await checkEvents(appData, 50);
        appData.rankedMapsFull = await getRankedMapsFull(appData.accessToken);
      } else {
        await checkEvents(appData, 50);
      }
    });

    if (error) {
      await initialRun();
      if (process.env.RESET_STORE) await saveAppData(appData);
    } else if (process.env.UPDATE_STORE) await saveAppData(appData);
  }

  sendData();

  schedule.scheduleJob("*/5 * * * *", async () => {
    try {
      const currDate = new Date();

      //#region RANK INTERVAL

      // check more often when a mapset is about to be ranked
      if (currDate.getUTCMinutes() % 20 === 0) {
        const compareDate = new Date(currDate.getTime() + 10 * MINUTE); // 10 minutes should be enough for almost every mapset

        // reset rankQueue
        rankQueue.splice(0, rankQueue.length);

        // get mapsets that could be ranked
        appData.qualifiedMaps.forEach((beatmapSets) => {
          for (let i = 0; i < Math.min(config.RANK_PER_RUN, beatmapSets.length); i++) {
            if (
              currDate >= beatmapSets[i].rankDateEarly ||
              (compareDate >= beatmapSets[i].rankDateEarly && beatmapSets[i].rankEarly)
            ) {
              // don't include maps with unresolved mod
              if (!beatmapSets[i].unresolved) rankQueue.push(beatmapSets[i]);
            } else break;
          }
        });

        if (rankQueue.length > 0) {
          const interval = 5000;
          const earliestRankDate = rankQueue[0].rankDateEarly;
          // increase check duration if maps in other modes
          const checkDuration = Math.min(8 + rankQueue.length * 2, 12) * MINUTE;
          const repeats =
            Math.ceil((checkDuration - Math.max(0, earliestRankDate - currDate)) / interval) + 1;

          setTimeout(
            () => setIntervalRep(sendEvent, interval, repeats),
            Math.max(0, earliestRankDate - currDate)
          );
        }
      }

      //#endregion RANK INTERVAL

      let update = false;

      // update unresolved mods every hour (at 50 min) and every 5 min for maps currently with unresolved mod
      for (const beatmapSets of appData.qualifiedMaps) {
        for (const beatmapSet of beatmapSets) {
          if (!beatmapSet.unresolved && currDate.getUTCMinutes() % 50 !== 0) continue;
          const prev = beatmapSet.unresolved;
          const unresolved = await beatmapSet.checkUnresolvedMod();
          if (prev !== unresolved) update = true;
        }
      }

      if (currDate.getUTCMinutes() % 10 === 0) {
        appData.qualifiedMaps.forEach((beatmapSets) => {
          for (let i = 0; i < Math.min(config.RANK_PER_RUN, beatmapSets.length); i++) {
            if (currDate >= beatmapSets[i].rankDateEarly) {
              if (beatmapSets[i].probability > config.SPLIT) {
                const temp = beatmapSets[i].probability;
                beatmapSets[i].probability = null;
                if (calcEarlyProbability(appData.qualifiedMaps, beatmapSets[i].rankDate.getTime()))
                  update = true;
                beatmapSets[i].probability = temp;
              }
            }
          }
        });
      }

      let newEvents = [];
      try {
        newEvents = await checkEvents(appData);
      } catch (error) {
        console.log(new Date().toISOString(), "- failed to get new events");
        console.log(error);
        if (error.response?.status === 401) await setToken();
      }
      if (newEvents.length > 0 || update) {
        sendData();
      }

      // update google storage twice per day
      if (
        !process.env.DEVELOPMENT_STORE &&
        currDate.getUTCHours() % 12 === 0 &&
        currDate.getUTCMinutes() === 0
      ) {
        await saveAppData(appData);
      }
    } catch (error) {
      console.log(error);
    }
  });
};

//#endregion SETUP & CRONJOB

setUp();

//#region ROUTES

app.get("/beatmapsets", (req, res) => {
  if ("full" in req.query) {
    res.status(200).json(reduceQualifiedMaps(appData.qualifiedMaps));
  } else if ("stream" in req.query) {
    const headers = {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    };
    res.writeHead(200, headers);

    const data = `data: ${JSON.stringify(reduceQualifiedMaps(appData.qualifiedMaps))}\n\n`;

    res.write(data);

    const clientId = Date.now();

    const newClient = {
      id: clientId,
      res,
    };

    clients.push(newClient);

    req.on("close", () => {
      clients = clients.filter((client) => client.id !== clientId);
      res.end();
    });
  } else {
    res.status(200).json(
      appData.qualifiedMaps
        .flat()
        .sort((a, b) => a.rankDateEarly - b.rankDateEarly)
        .map((beatmapSet) => {
          return {
            id: beatmapSet.id,
            artist: beatmapSet.artist,
            title: beatmapSet.title,
            rank_time: beatmapSet.rankDate.toISOString(),
            rank_early: beatmapSet.rankEarly,
            beatmaps: beatmapSet.beatmaps.map((beatmap) => {
              return {
                id: beatmap.id,
                spinners: beatmap.spin,
                length: beatmap.len,
                version: beatmap.ver,
              };
            }),
          };
        })
    );
  }
});

app.get("/beatmapsets/:id", (req, res) => {
  const beatmapSet = appData.qualifiedMaps
    .flat()
    .filter((beatmapSet) => beatmapSet.id == req.params.id)[0];
  if (beatmapSet == undefined) res.sendStatus(404);
  else {
    res.status(200).json({
      id: beatmapSet.id,
      artist: beatmapSet.artist,
      title: beatmapSet.title,
      rank_time: beatmapSet.rankDate.toISOString(),
      rank_early: beatmapSet.rankEarly,
      beatmaps: beatmapSet.beatmaps.map((beatmap) => {
        return {
          id: beatmap.id,
          spinners: beatmap.spin,
          length: beatmap.len,
          version: beatmap.ver,
        };
      }),
    });
  }
});

app.get("/ranked", (_, res) => {
  res.status(200).json(reduceRankedMaps(appData.rankedMapsFull));
});

//#endregion ROUTES

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`);
});
