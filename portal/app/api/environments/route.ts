import { executionEnvironments, snapshot } from "../../snapshot";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_environment_index.v2",
    source: snapshot.source,
    environments: executionEnvironments,
  });
}
