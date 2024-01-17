const { Storage } = require("@google-cloud/storage");
const { JSONToBeatmapSet } = require("./osuHelpers");

require("dotenv").config();

const storage = new Storage({ keyFilename: "google-cloud-key.json" });
const bucket = storage.bucket("mapranktimes");
const fileName = process.env.DEVELOPMENT_STORE ? "appDataDev.json" : "appData.json";

const saveAppData = async (appData) => {
  const file = bucket.file(fileName);
  const contents = JSON.stringify(appData);
  try {
    await file.save(contents);
    console.log(new Date().toISOString(), "- saved appData to google storage");
  } catch (error) {
    console.log(new Date().toISOString(), "- failed to save to google storage", error);
  }
};

const loadAppData = async (appData, callback) => {
  try {
    const res = await bucket.file(fileName).download();
    const storedData = JSON.parse(res[0]);
    appData.accessToken = storedData.accessToken;
    appData.expireDate = new Date(storedData.expireDate);
    appData.lastEventId = storedData.lastEventId;
    appData.rankedMaps = storedData.rankedMaps.map((beatmapSets) =>
      beatmapSets.map((beatmapSet) => JSONToBeatmapSet(beatmapSet))
    );
    appData.rankedMapsFull = storedData.rankedMapsFull.map((beatmapSets) =>
      beatmapSets.map((beatmapSet) => JSONToBeatmapSet(beatmapSet))
    );
    appData.qualifiedMaps = storedData.qualifiedMaps.map((beatmapSets) =>
      beatmapSets.map((beatmapSet) => JSONToBeatmapSet(beatmapSet))
    );
    console.log(new Date().toISOString(), "- loaded appData from google storage");
    await callback();
  } catch (error) {
    console.log(new Date().toISOString(), "- failed to get stored data");
    console.log(error);
    return error;
  }
};

module.exports.saveAppData = saveAppData;
module.exports.loadAppData = loadAppData;
