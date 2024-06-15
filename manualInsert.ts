import { createClient } from "@supabase/supabase-js";
import { getBeatmapSet } from "./osuRequests";
import { Database } from "./database.types";
import { beatmapSetToDatabase } from "./utils";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const insertMap = async (beatmapSetId: number) => {
  var { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  const newBeatmapSet = await getBeatmapSet(appData.access_token, beatmapSetId);
  const { error: errorBeatmapSets } = await supabase
    .from("beatmapsets")
    .upsert([beatmapSetToDatabase(newBeatmapSet)]);
  if (errorBeatmapSets) console.log(errorBeatmapSets);
};

insertMap(0);
