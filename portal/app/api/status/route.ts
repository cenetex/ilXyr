import { currentFreshness, siteStatus, snapshot } from "../../snapshot";

export async function GET() {
  return Response.json({ schema: "ilxyr.public_status.v2", source: snapshot.source,
    source_health: snapshot.source_health, freshness: currentFreshness(), status: siteStatus() });
}
