import {
  Beatmap,
  BeatmapAPI,
  BeatmapSet,
  BeatmapSetAPI,
  BeatmapSetDatabase,
  MapEvent,
  MapEventAPI,
} from "./beatmap.types";

export const beatmapSetFromAPI = ({
  id,
  artist,
  title,
  creator,
  user_id,
  ranked_date,
  beatmaps,
  status,
}: BeatmapSetAPI): BeatmapSet => {
  return {
    id,
    queueDate: null,
    rankDate: status == "qualified" ? null : new Date(ranked_date),
    rankDateEarly: null,
    artist,
    title,
    mapper: creator,
    mapperId: user_id,
    probability: null,
    unresolved: false,
    beatmaps: beatmaps
      ?.map((beatmap) => beatmapFromAPI(beatmap))
      .sort((a, b) => (b.sr < a.sr ? 1 : -1)),
    mode: Math.min(...beatmaps.map((beatmap) => beatmap.mode_int)),
    lastQualifiedDate: status == "qualified" ? new Date(ranked_date) : null, // only used during setup
  };
};

const beatmapFromAPI = ({
  id,
  version,
  count_spinners,
  difficulty_rating,
  total_length,
  mode_int,
}: BeatmapAPI): Beatmap => {
  return {
    id,
    ver: version,
    spin: count_spinners,
    sr: difficulty_rating,
    len: total_length,
    mode: mode_int,
  };
};

export const beatmapSetFromDatabase = ({
  id,
  queue_date,
  rank_date,
  rank_date_early,
  artist,
  title,
  mapper,
  mapper_id,
  probability,
  unresolved,
  beatmaps,
}: BeatmapSetDatabase): BeatmapSet => {
  const parsedBeatmaps: Beatmap[] = typeof beatmaps === "string"
    ? JSON.parse(beatmaps)
    : beatmaps;
  return {
    id,
    queueDate: queue_date == null ? null : new Date(queue_date * 1000),
    rankDate: new Date(rank_date * 1000),
    rankDateEarly: rank_date_early == null
      ? null
      : new Date(rank_date_early * 1000),
    artist,
    title,
    mapper,
    mapperId: mapper_id,
    probability,
    unresolved,
    beatmaps: parsedBeatmaps,
    mode: Math.min(...parsedBeatmaps.map((beatmap) => beatmap.mode)),
  };
};

export const mapEventFromAPI = (
  { id, beatmapset, type, created_at, discussion }: MapEventAPI,
): MapEvent => {
  return {
    id,
    beatmapSetId: beatmapset?.id ?? discussion.beatmapset_id,
    type,
    createdAt: new Date(created_at),
  };
};

export const beatmapSetToDatabase = ({
  id,
  queueDate,
  rankDate,
  rankDateEarly,
  artist,
  title,
  mapper,
  mapperId,
  probability,
  unresolved,
  beatmaps,
}: BeatmapSet): BeatmapSetDatabase => {
  return {
    id,
    queue_date: queueDate == null ? null : queueDate.getTime() / 1000,
    rank_date: rankDate!.getTime() / 1000,
    rank_date_early: rankDateEarly == null
      ? null
      : rankDateEarly.getTime() / 1000,
    artist,
    title,
    mapper,
    mapper_id: mapperId,
    probability,
    unresolved,
    beatmaps: JSON.stringify(beatmaps),
  };
};

export const databaseToSplitModes = (data: BeatmapSetDatabase[]) => {
  const splitMaps: BeatmapSet[][] = [[], [], [], []];
  data.forEach((item) => {
    const beatmapSet = beatmapSetFromDatabase(item);
    splitMaps[beatmapSet.mode].push(beatmapSet);
  });
  return splitMaps;
};
