import { siteStatus } from "../../catalog";

export async function GET() {
  return Response.json({ schema: "ilxyr.public_status.v1", status: siteStatus });
}
