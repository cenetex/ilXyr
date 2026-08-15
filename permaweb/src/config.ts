const DEFAULT_PUBLISHERS = [
  "I5Z-EnOhkasZjtaMu9IbSVK3duWSecQpZ0lnKFEjjRg",
  "CYVtYCPST9t7ziybtEpHSxncOEgCiofFatuiHcTFSjA",
  "Tp9rnI0lVaMBpPbhbofJXTBI6yJtfoxrI5KWM4GEXKE",
  "PWFAC17n2EiUXKICMO_gEND8C86SWnc5pANBX7TAPkE",
  "5-RWj5HyTnqdanAebjcRSrqu5oPqN0Jk2VZ9nRFvvz0",
  "kHK-OR_6S6p89Q2VdGAsbUyUscIws4O51vST5LYOjsk",
  "dFGQBNylv-sEZKOvDxSPHmrr423_dU8fhbXc1AhPD2E",
].join(",");

export const config = {
  gateway: (import.meta.env.VITE_ARWEAVE_GATEWAY || "https://arweave.net").replace(/\/$/, ""),
  publishers: (import.meta.env.VITE_ILXYR_PUBLISHERS || DEFAULT_PUBLISHERS)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean),
  indexTx: (import.meta.env.VITE_ILXYR_INDEX_TX || "").trim(),
  aoProcess: (import.meta.env.VITE_ILXYR_AO_PROCESS || "").trim(),
  arnsName: (import.meta.env.VITE_ILXYR_ARNS_NAME || "").trim(),
  seedTransactions: [
    "jguWIRC2oP5gNWNmGNNeLIGD9t155X6orv9FREZmHBk",
    "f35OgXuOoulk9EcndJBNWIgZ5tmaQ6DRzeINP7ARZTU",
    "h96JlX-4ttZsPZdYRBuT-_JNO2s0lS18hoFjM4ojYSw",
    "S_abPRyuad89zt2QFN-f9G6kIbumkvqBWqg5_K0SkJk",
    "zoZh-bZWRN_rlBuC-AONvZg5CbI6NIpkrbgepz7J5cM",
    "Ks5BCVFX6179VUXQL8lMczLXX6hAp7j-lUpOcXikiTs",
    "RaDOgThGonnt9eLUe_1eKjJukMY-FnbXlBYSRmCUSa0",
  ],
};

export function arweaveUrl(txId: string, path = "") {
  const suffix = path ? `/${path.split("/").map(encodeURIComponent).join("/")}` : "";
  return `${config.gateway}/${txId}${suffix}`;
}
