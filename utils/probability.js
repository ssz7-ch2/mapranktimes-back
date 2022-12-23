const { DELAY_MIN, DELAY_MAX } = require("../config");
const { uniformSumCDF } = require("./distributions");
const { permutations } = require("itertools");

// when beatmapSets == 0, probability represents ranking function check time
// otherModes, beatmaps in other modes, list of length 3 [0, 0, 0]
const probabilityAfter = (seconds, beatmapSets = 0, otherModes = null) => {
  let sum = 0;
  const memo = {};
  // calculate probability for each ranking position (1 means this gamemode is first in queue)
  for (let i = 1; i <= 4; i++) {
    // each beatmapSet also has its own delay
    let total = i + beatmapSets;

    let modeSum = 0;

    // list of sums for each permutation of otherModes (beacuse of shuffle)
    let permSums = [0];
    if (otherModes) {
      if (i == 2) permSums = otherModes;
      else if (i === 3) {
        const temp = [];
        for (const perm of permutations(otherModes, 2)) {
          temp.push(perm.reduce((a, b) => a + b, 0));
        }
        permSums = temp;
      } else if (i === 4) {
        permSums = [otherModes.reduce((a, b) => a + b, 0)];
      }
    }
    for (const permSum of permSums) {
      if (total + permSum in memo) {
        modeSum += memo[total + permSum];
        continue;
      }
      const transformed = (seconds - (total + permSum) * DELAY_MIN) / (DELAY_MAX - DELAY_MIN);
      const value = 1 - uniformSumCDF(total + permSum, transformed);
      memo[total + permSum] = value;
      modeSum += value;
    }
    sum += modeSum / permSums.length;
  }
  return sum / 4;
};

const probabilityBefore = (seconds, beatmapSets = 0, otherModes = null) =>
  1 - probabilityAfter(seconds, beatmapSets, otherModes);

// probability of map being ranked in range
const probabilityRange = (start, end, beatmapSets = 1, otherModes = null) =>
  probabilityAfter(start, beatmapSets, otherModes) +
  probabilityBefore(end, beatmapSets, otherModes) -
  1;

module.exports.probabilityAfter = probabilityAfter;
module.exports.probabilityBefore = probabilityBefore;
module.exports.probabilityRange = probabilityRange;
