import {
  cliGroups,
  guide,
  protocolDocuments,
  publicRoutes,
  repository,
} from "./catalog";
import { executionEnvironments, experiments, publicResults, snapshot } from "./snapshot";
import { ProtocolPortal } from "./ProtocolPortal";

export default function Home() {
  return (
    <ProtocolPortal
      routes={publicRoutes}
      modelLines={snapshot.model_lines}
      environments={executionEnvironments}
      results={publicResults}
      experiments={experiments}
      source={snapshot.source}
      documents={protocolDocuments}
      cliGroups={cliGroups}
      repository={repository}
      guide={guide}
    />
  );
}
