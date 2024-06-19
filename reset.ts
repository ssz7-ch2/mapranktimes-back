import { createClient } from "@supabase/supabase-js";
import { setUp } from "./setup";
import { Database } from "./database.types";

require("dotenv").config();

// remove all rows in both tables
// then do setup again

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const deleteRows = async () => {
  const { error: errorAppData } = await supabase.from("app_data").delete().gt(
    "id",
    -1,
  );
  if (errorAppData) console.log(errorAppData);

  const { error: errorBeatmapSets } = await supabase.from("beatmapsets")
    .delete().gt("id", -1);
  if (errorBeatmapSets) console.log(errorBeatmapSets);

  setUp();
};

if (require.main === module) {
  deleteRows();
}
