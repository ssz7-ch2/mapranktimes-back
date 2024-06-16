import { createClient } from "@supabase/supabase-js";
import { getAccessToken, getMapsUnresolved } from "./osuRequests";
import { Database } from "./database.types";

require("dotenv").config();

const supabase = createClient<Database>(
  process.env.SUPABASE_URL!,
  process.env.SERVICE_ROLE!,
);

const updateUnresolved = async () => {
  let { data: res, error } = await supabase.from("app_data").select("*");
  if (!res || error) throw new Error(`failed to get app_data. Error: ${error}`);

  const appData = res[0];

  let accessToken = appData.access_token;
  let expireDate = appData.expire_date;

  if (accessToken === null || Date.now() >= expireDate) {
    [accessToken, expireDate] = await getAccessToken();
    const { error } = await supabase
      .from("app_data")
      .update({
        access_token: accessToken,
        expire_date: expireDate,
      })
      .eq("id", 1);
    if (error) console.log(error);
  }

  const mapsToUpdate: { id: number; unresolved: boolean }[] = [];
  const updatedMaps: number[] = [];

  let { data: unresolvedMaps, error: errorUnresolved } = await supabase
    .from("beatmapsets")
    .select("*")
    .is("unresolved", true);
  if (!unresolvedMaps || errorUnresolved) {
    throw new Error(`failed to get unresolvedMaps. Error: ${errorUnresolved}`);
  }

  const updatedUnresolvedMaps = await getMapsUnresolved(accessToken);
  const unresolvedMapIds = updatedUnresolvedMaps.map((beatmapSet) =>
    beatmapSet.id
  );
  unresolvedMaps.forEach((beatmapSet) => {
    if (!unresolvedMapIds.includes(beatmapSet.id)) {
      mapsToUpdate.push({
        id: beatmapSet.id,
        unresolved: false,
      });
      updatedMaps.push(beatmapSet.id);
    } else {
      // remove maps that are in both
      // remaining ids will be newly unresolved maps
      unresolvedMapIds.splice(unresolvedMapIds.indexOf(beatmapSet.id), 1);
    }
  });

  unresolvedMapIds.forEach((beatmapSetId) => {
    mapsToUpdate.push({
      id: beatmapSetId,
      unresolved: true,
    });
    updatedMaps.push(beatmapSetId);
  });

  for (const beatmapSet of mapsToUpdate) {
    // use update here since mapsToUpdate.length is usually around 0-1
    const { error } = await supabase
      .from("beatmapsets")
      .update({ unresolved: beatmapSet.unresolved })
      .eq("id", beatmapSet.id);
    if (error) console.log(error);
  }

  if (updatedMaps.length > 0) {
    const { error } = await supabase
      .from("updates")
      .upsert({ id: 1, updated_maps: updatedMaps, deleted_maps: [] });
    if (error) console.log(error);
  }

  const message = `${mapsToUpdate.length} map${
    mapsToUpdate.length === 1 ? "" : "s"
  } updated`;
  console.log(`${new Date().toISOString()} - ${message}`);
};

if (require.main === module) {
  updateUnresolved();
}
