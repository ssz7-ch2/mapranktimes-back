const axios = require("axios");
const config = require("./config");
const { DAY } = require("./utils/timeConstants");

class BeatmapSet {
  constructor({ id, artist, title, creator, user_id, ranked_date, beatmaps, status }) {
    this.id = id;
    this.queueDate = null;
    this.rankDate = new Date(ranked_date);
    this.rankDateEarly = null;
    this.artist = artist;
    this.title = title;
    this.mapper = creator;
    this.mapperId = user_id;
    this.beatmaps = beatmaps
      .map((beatmap) => new Beatmap(beatmap))
      .sort((a, b) => (b.stars < a.stars ? 1 : -1));
    this.rankEarly = false;
    this.probability = status == "qualified" ? null : 0;
    this.mode = Math.min(...beatmaps.map((beatmap) => beatmap.mode_int));
    this.unresolved = false;
  }

  static lastRequestDate = 0;

  async getJSON() {
    // avoid getting rate limited :)
    if (Date.now() - BeatmapSet.lastRequestDate < 1500)
      await new Promise((resolve) => setTimeout(resolve, 1500));

    const url = `https://osu.ppy.sh/beatmapsets/${this.id}/discussion?format=json`;
    let res;
    while (res?.status != 200) {
      try {
        res = await axios.get(url);
        BeatmapSet.lastRequestDate = Date.now();
        return res;
      } catch (err) {
        console.log(err);
        await new Promise((resolve) => setTimeout(resolve, 30000));
      }
    }
  }

  async getQueueTime() {
    console.log(
      new Date().toISOString(),
      `- calculating queueDate for ${this.id} ${this.artist} - ${this.title}`
    );

    const res = await this.getJSON();

    const events = res.data.beatmapset.events
      .filter((event) => event.type === "qualify" || event.type === "disqualify")
      .map((event) => ({ type: event.type, time: Date.parse(event.created_at) }));

    let previousQueueDuration = 0;
    let startDate;

    events.forEach((event) => {
      if (event.type === "qualify") startDate = event.time;
      else if (event.type === "disqualify" && startDate != null)
        previousQueueDuration += event.time - startDate;
    });

    // all maps need to be qualified for at least 7 days
    const queueDuration = config.MINIMUM_DAYS_FOR_RANK * DAY;

    const timeLeft = queueDuration - previousQueueDuration;

    // this.rankDate is the latest qualified date
    // maps need to be qualified for at least 1 day since lastest qualified date
    this.queueDate = new Date(this.rankDate.getTime() + Math.max(DAY, timeLeft));

    // also get unresolved
    checkUnresolvedMod(res);

    console.log(new Date().toISOString(), "- success");
  }

  async checkUnresolvedMod(res = null) {
    res ??= await this.getJSON();
    const discussions = res.data.beatmapset.discussions.filter(
      (discussion) =>
        (discussion.message_type === "suggestion" || discussion.message_type === "problem") &&
        discussion.resolved === false &&
        (discussion.beatmap_id == null ||
          this.beatmaps.filter((b) => b.id == discussion.beatmap_id).length > 0)
    );

    if (discussions.length > 0) {
      this.unresolved = true;
    } else {
      this.unresolved = false;
    }
    return this.unresolved;
  }

  static reduced(beatmapSet) {
    const r = {
      id: beatmapSet.id,
      rd: beatmapSet.rankDate.getTime() / 1000,
      rde:
        beatmapSet.rankDateEarly !== null
          ? beatmapSet.rankDateEarly.getTime() / 1000
          : beatmapSet.rankDate.getTime() / 1000,
      a: beatmapSet.artist,
      t: beatmapSet.title,
      m: beatmapSet.mapper,
      mi: beatmapSet.mapperId,
      b: beatmapSet.beatmaps.map((beatmap) => {
        return {
          id: beatmap.id,
          s: beatmap.spin,
          l: beatmap.len,
          v: beatmap.ver,
          sr: beatmap.stars,
          m: beatmap.mode,
        };
      }),
      re: beatmapSet.rankEarly,
      p: beatmapSet.probability,
      u: beatmapSet.unresolved,
    };
    return r;
  }
}

class Beatmap {
  constructor({ id, version, count_spinners, difficulty_rating, total_length, mode_int }) {
    this.id = id;
    this.ver = version;
    this.spin = count_spinners;
    this.stars = difficulty_rating;
    this.len = total_length;
    this.mode = mode_int;
  }
}

class MapEvent {
  constructor({ id, beatmapset, type, created_at }) {
    this.id = id;
    this.beatmapSetId = beatmapset.id;
    this.type = type;
    this.createdAt = new Date(created_at);
  }
}

module.exports.BeatmapSet = BeatmapSet;
module.exports.Beatmap = Beatmap;
module.exports.MapEvent = MapEvent;
