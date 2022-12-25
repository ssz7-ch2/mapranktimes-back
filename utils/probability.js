const { DELAY_MIN, DELAY_MAX } = require("../config");
const { uniformSumCDF } = require("./distributions");

// **not accurate when there are other modes with same rank date
//   calculation becomes much more complicated when accounting for other modes
// TODO: try to account for other modes
// when beatmapSets == 0, probability represents when the ranking function runs
const probabilityAfter = (seconds, beatmapSets = 0) => {
  let sum = 0;
  // calculate probability for each ranking position (1 means this gamemode is first in queue)
  for (let i = 1; i <= 4; i++) {
    // each beatmapSet also has its own delay
    let total = i + beatmapSets;
    const transformed = (seconds - total * DELAY_MIN) / (DELAY_MAX - DELAY_MIN);
    sum += 1 - uniformSumCDF(total, transformed);
  }
  return sum / 4;
};

module.exports.probabilityAfter = probabilityAfter;
