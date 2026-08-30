import { cliGroups, protocolDocuments } from "../../catalog";

export async function GET() {
  return Response.json({
    schema: "ilxyr.public_protocol_index.v1",
    documents: protocolDocuments,
    command_line: cliGroups,
  });
}
