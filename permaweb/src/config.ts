const DEFAULT_PUBLISHER = "I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg";

export const config = {
  gateway: (import.meta.env.VITE_ARWEAVE_GATEWAY || "https://arweave.net").replace(/\/$/, ""),
  publishers: (import.meta.env.VITE_ILXYR_PUBLISHERS || DEFAULT_PUBLISHER)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  indexTx: (import.meta.env.VITE_ILXYR_INDEX_TX || "").trim(),
  aoProcess: (import.meta.env.VITE_ILXYR_AO_PROCESS || "").trim(),
  arnsName: (import.meta.env.VITE_ILXYR_ARNS_NAME || "").trim(),
  seedTransactions: ["jguWIRC2oP5gNWNmGNNeLIGD9t155X6orv9FREZmHBk"],
};

export function arweaveUrl(txId: string, path = "") {
  const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return `${config.gateway}/${txId}${suffix}`;
}
