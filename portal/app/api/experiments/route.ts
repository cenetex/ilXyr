import { experiments } from "../../catalog";

export async function GET() {
  return Response.json({ schema: "ilxyr.public_experiment_index.v1", experiments });
}
