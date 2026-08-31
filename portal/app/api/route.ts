import { publicRoutes } from "../catalog";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_api_index.v1",
    service: "ilXyr protocol index",
    routes: publicRoutes,
  });
}
