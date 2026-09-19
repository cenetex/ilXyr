import { discovery } from "../../catalog";

export async function GET() {
  return Response.json(discovery);
}
