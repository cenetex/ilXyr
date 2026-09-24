import { experiments, snapshot } from "../../snapshot";

export async function GET() {
  return Response.json({ schema: "ilxyr.public_experiment_index.v2", source: snapshot.source,
    source_health: snapshot.source_health, experiments });
}
