type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type BeatmapSet = {
  id: number;
  queueDate: Date | null;
  rankDate: Date | null;
  rankDateEarly: Date | null;
  artist: string;
  title: string;
  mapper: string;
  mapperId: number;
  probability: number | null;
  unresolved: boolean;
  beatmaps: Beatmap[];
  mode: number;
  lastQualifiedDate?: Date | null;
};

export type Beatmap = {
  id: number;
  ver: string;
  spin: number;
  sr: number;
  len: number;
  mode: number;
};

export type BeatmapSetAPI = {
  id: number;
  artist: string;
  title: string;
  creator: string;
  user_id: number;
  ranked_date: string;
  beatmaps: BeatmapAPI[];
  status: "qualified" | "ranked";
};

export type BeatmapAPI = {
  id: number;
  version: string;
  count_spinners: number;
  difficulty_rating: number;
  total_length: number;
  mode_int: number;
};

export type BeatmapSetDatabase = {
  id: number;
  queue_date: number | null;
  rank_date: number;
  rank_date_early: number | null;
  artist: string;
  title: string;
  mapper: string;
  mapper_id: number;
  probability: number | null;
  unresolved: boolean;
  beatmaps: Json;
};

export type MapEvent = {
  id: number;
  beatmapSetId: number;
  type: "rank" | "qualify" | "disqualify";
  createdAt: Date;
};

export type MapEventAPI = {
  id: number;
  beatmapset: {
    id: number;
  };
  type: "rank" | "qualify" | "disqualify";
  created_at: string;
};
