import { DELAY_MAX, DELAY_MIN } from "../config";
import { uniformSumCDF } from "./distributions";
import { permutations } from "itertools";

// **not 100% accurate when there are other modes with same rank date
//   calculation becomes much more complicated when accounting for other modes
// when beatmapSets == 0, probability represents when the ranking function runs
export const probabilityAfter = (seconds: number, otherModes?: number[]) => {
  let sum = 0;
  const memo: { [key: number]: number } = {};
  // calculate probability for each ranking position (1 means this gamemode is first in queue)
  for (let pos = 1; pos <= 4; pos++) {
    let modeSum = 0;

    let permSums = [0];
    if (otherModes) {
      if (pos == 2) permSums = otherModes;
      else if (pos === 3) {
        const temp: number[] = [];
        for (const perm of permutations(otherModes, 2)) {
          temp.push(perm.reduce((a, b) => a + b, 0));
        }
        permSums = temp;
      } else if (pos === 4) {
        permSums = [otherModes.reduce((a, b) => a + b, 0)];
      }
    }
    for (const permSum of permSums) {
      if (pos + permSum in memo) {
        modeSum += memo[pos + permSum];
        continue;
      }
      const transformed = (seconds - (pos + permSum) * DELAY_MIN) /
        (DELAY_MAX - DELAY_MIN);
      const value = 1 - uniformSumCDF(pos + permSum, transformed);
      memo[pos + permSum] = value;
      modeSum += value;
    }
    sum += modeSum / permSums.length;
  }
  return +`${(sum / 4)}`.slice(0, 7);
};
