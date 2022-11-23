const express = require("express");
const {
  getAccessToken,
  getLatestEvent,
  getRankedMaps,
  getQualifiedMaps,
} = require("./osuRequests");
const app = express();
const cors = require("cors");
const schedule = require("node-schedule");
const { adjustRankDates, checkEvents } = require("./osuHelpers");
const { loadAppData, saveAppData } = require("./storage");
const config = require("./config");
const { MINUTE } = require("./utils/timeConstants");

app.use(cors());
app.use(express.static("public"));

require("dotenv").config();

const PORT = process.env.PORT || 5000;
let clients = [];

const appData = {
  accessToken: null,
  expireDate: null,
  lastEventId: null,
  rankedMaps: [],
  qualifiedMaps: [],
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

//#region CRONJOB functions

let running = false;

// return true if rankQueue is empty
const sendEvent = async () => {
  // don't run more than one update simultaneously
  if (running) return false;

  running = true;
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
    running = false;
    return true;
  }

  if (newEvents.length === 0) {
    running = false;
    return rankQueue.length === 0;
  }

  console.log(new Date().toISOString(), "- sending data to client");
  clients.forEach((client) =>
    client.res.write(
      `data: ${JSON.stringify(appData.qualifiedMaps.map((beatmapSet) => beatmapSet.reduced()))}\n\n`
    )
  );

  // remove from queue if map is ranked
  rankQueue = rankQueue.filter((queueSet) =>
    appData.qualifiedMaps.some((beatmapSet) => beatmapSet.id == queueSet.id)
  );

  running = false;
  return rankQueue.length == 0;
};

// TODO: add condition
const setIntervalRep = async (callback, interval, repeats, count = 0) => {
  // let endInterval = false;
  // if (condition()) endInterval = await callback();
  const endInterval = await callback();

  if (++count === repeats || endInterval) return;

  setTimeout(() => setIntervalRep(callback, interval, repeats, count), interval);
};

//#endregion CRONJOB functions

const initialRun = async () => {
  await setToken();
  appData.lastEventId = await getLatestEvent(appData.accessToken);

  appData.rankedMaps = await getRankedMaps(appData.accessToken);
  console.log(new Date().toISOString(), "- finished getting rankedMaps");
  appData.qualifiedMaps = await getQualifiedMaps(appData.accessToken);
  console.log(new Date().toISOString(), "- finished getting qualifiedMaps");
  adjustRankDates(appData.qualifiedMaps, appData.rankedMaps);
  console.log(new Date().toISOString(), "- finished adjusting rank times");
};

// set up appData
const setUp = async () => {
  const error = await loadAppData(appData, async () => {
    if (appData.accessToken === null || Date.now() >= appData.expireDate) {
      await setToken();
    }
    await checkEvents(appData);
  });

  if (error) {
    await initialRun();
    await saveAppData(appData);
  }

  console.log(new Date().toISOString(), "- sending data to client");
  clients.forEach((client) =>
    client.res.write(
      `data: ${JSON.stringify(appData.qualifiedMaps.map((beatmapSet) => beatmapSet.reduced()))}\n\n`
    )
  );

  schedule.scheduleJob("*/5 * * * *", async () => {
    try {
      const currDate = new Date();

      //#region RANK INTERVAL

      // check more often when a mapset is about to be ranked
      if (currDate.getUTCMinutes() % 20 === 0) {
        const compareDate = new Date(currDate.getTime() + 8 * MINUTE); // 8 minutes should be enough for most mapsets

        // reset rankQueue
        rankQueue.splice(0, rankQueue.length);

        // get mapsets that could be ranked
        // TODO: for each mode
        // rankQueue = [[mode, beatmapset], ...] sort by queueDate
        for (let i = 0; i < Math.min(config.RANK_PER_RUN, appData.qualifiedMaps.length); i++) {
          if (
            compareDate >=
            (appData.qualifiedMaps[i].rankEarly
              ? appData.qualifiedMaps[i].rankDateEarly
              : appData.qualifiedMaps[i].rankDate)
          )
            rankQueue.push(appData.qualifiedMaps[i]);
          else break;
        }

        const interval = 2000;

        if (rankQueue.length > 0) {
          // TODO: if rankQueue has maps from othr modes, recalculate rankEarly probability (and send to client)
          const earliestRankDate = rankQueue[0].rankEarly
            ? rankQueue[0].rankDateEarly
            : rankQueue[0].rankDate;
          // increase check duration if maps in other modes
          const checkDuration = 10 * MINUTE;
          if (currDate >= earliestRankDate) {
            const repeats = Math.ceil(checkDuration / interval);
            setIntervalRep(async () => await sendEvent(), interval, repeats);
          } else {
            const repeats =
              Math.ceil(
                (currDate.getTime() + checkDuration - earliestRankDate.getTime()) / interval
              ) + 1;

            // don't start interval until after rankDateEarly
            setTimeout(
              () => setIntervalRep(async () => await sendEvent(), interval, repeats),
              earliestRankDate - currDate
            );
          }
        }
      }

      //#endregion RANK INTERVAL

      await sendEvent();

      // update google storage twice per day
      if (currDate.getUTCHours() % 12 === 0 && currDate.getUTCMinutes() === 0) {
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
    res.status(200).json(appData.qualifiedMaps.map((beatmapSet) => beatmapSet.reduced()));
  } else if ("stream" in req.query) {
    const headers = {
      "Content-Type": "text/event-stream",
      Connection: "keep-alive",
      "Cache-Control": "no-cache",
      "Access-Control-Allow-Origin": "*",
    };
    res.writeHead(200, headers);

    const data = `data: ${JSON.stringify(
      appData.qualifiedMaps.map((beatmapSet) => beatmapSet.reduced())
    )}\n\n`;

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
      appData.qualifiedMaps.map((beatmapSet) => {
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
  const beatmapSet = appData.qualifiedMaps.filter(
    (beatmapSet) => beatmapSet.id == req.params.id
  )[0];
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

//#endregion ROUTES

app.listen(PORT, () => {
  console.log(`listening on port ${PORT}`);
});
