import { executionEnvironments } from "../../catalog";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_environment_index.v1",
    environments: executionEnvironments,
  });
}
