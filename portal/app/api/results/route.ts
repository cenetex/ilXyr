import { verifiedExecutionResults } from "../../catalog";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_verified_result_index.v1",
    results: verifiedExecutionResults,
  });
}
