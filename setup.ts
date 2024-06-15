import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getRankedMaps, getQualifiedMaps, getLatestEvent } from "./osuRequests";
import { adjustAllRankDates } from "./osuHelpers";
import { beatmapSetToDatabase } from "./utils";
import { Database } from "./database.types";

require("dotenv").config();

const supabase = createClient<Database>(process.env.SUPABASE_URL!, process.env.SERVICE_ROLE!);

export const setUp = async () => {
  const [accessToken, expireDate] = await getAccessToken();
  const lastEventId = await getLatestEvent(accessToken);
  const rankedMaps = await getRankedMaps(accessToken);
  const qualifiedMaps = await getQualifiedMaps(accessToken);

  adjustAllRankDates(qualifiedMaps, rankedMaps);

  let { error: errorAppData } = await supabase
    .from("app_data")
    .insert([
      { id: 1, access_token: accessToken, expire_date: expireDate, last_event_id: lastEventId },
    ])
    .select();

  if (errorAppData) console.log(errorAppData);

  const combinedMaps = qualifiedMaps.flat().concat(rankedMaps.flat());
  const formattedData = combinedMaps.map((beatmapSet) => beatmapSetToDatabase(beatmapSet));

  let { error: errorBeatmapSets } = await supabase.from("beatmapsets").insert(formattedData);
  if (errorBeatmapSets) console.log(errorBeatmapSets);
};

if (require.main === module) {
  setUp();
}
