import { siteStatus } from "./catalog";
import { ProtocolPortal } from "./ProtocolPortal";

export default function Home() {
  return <ProtocolPortal status={siteStatus} />;
}
