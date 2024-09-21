import { createClient } from "@supabase/supabase-js";
import { setUp } from "./setup";
import { Database } from "./database.types";
import { beatmapSetToDatabase } from "./utils";
import {
  getAccessToken,
  getLatestEvent,
  getQualifiedMaps,
  getRankedMaps,
} from "./osuRequests";
import { adjustAllRankDates } from "./osuHelpers";

require("dotenv").config();

// remove all rows in both tables
// then do setup again

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const reset = async () => {
  const [accessToken, expireDate] = await getAccessToken();
  const lastEventId = await getLatestEvent(accessToken);
  const rankedMaps = await getRankedMaps(accessToken);
  const qualifiedMaps = await getQualifiedMaps(accessToken);

  adjustAllRankDates(qualifiedMaps, rankedMaps);

  const { error: errorAppData } = await supabase.from("app_data").delete().gt(
    "id",
    -1,
  );
  if (errorAppData) console.log(errorAppData);

  const { error: errorBeatmapSets } = await supabase.from("beatmapsets")
    .delete().gt("id", -1);
  if (errorBeatmapSets) console.log(errorBeatmapSets);

  let { error: errorAppData2 } = await supabase
    .from("app_data")
    .insert([
      {
        id: 1,
        access_token: accessToken,
        expire_date: expireDate,
        last_event_id: lastEventId,
      },
    ])
    .select();

  if (errorAppData2) console.log(errorAppData2);

  const combinedMaps = qualifiedMaps.flat().concat(rankedMaps.flat());
  const formattedData = combinedMaps.map((beatmapSet) =>
    beatmapSetToDatabase(beatmapSet)
  );

  let { error: errorBeatmapSets2 } = await supabase.from("beatmapsets").insert(
    formattedData,
  );
  if (errorBeatmapSets2) console.log(errorBeatmapSets2);
};

if (require.main === module) {
  reset();
}
