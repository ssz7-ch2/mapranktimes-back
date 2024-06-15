import { createClient } from "@supabase/supabase-js";
import { getAccessToken } from "./osuRequests";
import { beatmapSetToDatabase, databaseToSplitModes } from "./utils";
import { Database } from "./database.types";
import { DAY, HOUR } from "./timeConstants";
import { adjustAllRankDates } from "./osuHelpers";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const recalculate = async () => {
  const { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  let updateAppData = false;

  let accessToken = appData.access_token;
  let expireDate = appData.expire_date;

  if (accessToken === null || Date.now() >= expireDate) {
    [accessToken, expireDate] = await getAccessToken();
    updateAppData = true;
  }

  const { data: qualifiedData, error: errorQualified } = await supabase
    .from("beatmapsets")
    .select("*")
    .not("queue_date", "is", null);

  const { data: rankedData, error: errorRanked } = await supabase
    .from("beatmapsets")
    .select("*")
    .is("queue_date", null)
    .gt("rank_date", Math.floor((Date.now() - DAY - HOUR) / 1000));

  if (!rankedData || !qualifiedData) {
    throw new Error(
      `missing data. errorQualified ${errorQualified}\nerrorRanked ${errorRanked}`,
    );
  }

  const qualifiedMaps = databaseToSplitModes(
    qualifiedData.sort((a, b) => a.queue_date! - b.queue_date!),
  );
  const rankedMaps = databaseToSplitModes(
    rankedData.sort((a, b) => a.rank_date - b.rank_date),
  );

  adjustAllRankDates(qualifiedMaps, rankedMaps);

  if (updateAppData) {
    const { error } = await supabase
      .from("app_data")
      .update(
        {
          access_token: accessToken,
          expire_date: expireDate,
        },
      )
      .eq("id", 1);
    if (error) console.log(error);
  }

  const formattedData = qualifiedMaps.flat().map((beatmapSet) =>
    beatmapSetToDatabase(beatmapSet)
  );

  let { error: errorBeatmapSets } = await supabase.from("beatmapsets").upsert(
    formattedData,
  );
  if (errorBeatmapSets) console.log(errorBeatmapSets);
};

if (require.main === module) {
  recalculate();
}
