import { publicResults, snapshot } from "../../snapshot";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_result_index.v2",
    source: snapshot.source,
    results: publicResults,
  });
}
