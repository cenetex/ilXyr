import {
  cliGroups,
  executionEnvironments,
  experiments,
  guide,
  protocolDocuments,
  publicRoutes,
  repository,
  siteStatus,
  verifiedExecutionResults,
} from "./catalog";
import { ProtocolPortal } from "./ProtocolPortal";

export default function Home() {
  return (
    <ProtocolPortal
      status={siteStatus}
      routes={publicRoutes}
      environments={executionEnvironments}
      results={verifiedExecutionResults}
      experiments={experiments}
      documents={protocolDocuments}
      cliGroups={cliGroups}
      repository={repository}
      guide={guide}
    />
  );
}
