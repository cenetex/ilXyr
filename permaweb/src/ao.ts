import { config } from "./config";
import type { AoSnapshot } from "./types";

type AoTag = { name: string; value: string };

function requireProcess() {
  if (!config.aoProcess) throw new Error("The ilXyr AO process has not been configured yet.");
  return config.aoProcess;
}

function extractData(response: unknown, expectedAction: string) {
  const output = response as {
    Messages?: { Data?: string; Tags?: AoTag[] }[];
    Output?: { data?: string } | string;
  };
  const match = output.Messages?.find((item) =>
    item.Tags?.some((tag) => tag.name === "Action" && tag.value === expectedAction),
  );
  if (match?.Data) return match.Data;
  if (typeof output.Output === "string") return output.Output;
  if (output.Output?.data) return output.Output.data;
  throw new Error(`AO did not return ${expectedAction}`);
}

function extractProcessError(response: unknown) {
  const output = response as { Error?: string; Messages?: { Data?: string; Tags?: AoTag[] }[] };
  if (output.Error) return output.Error;
  const message = output.Messages?.find((item) =>
    item.Tags?.some((tag) => tag.name === "Action" && tag.value === "Error"),
  );
  if (!message?.Data) return "";
  try {
    const data = JSON.parse(message.Data) as { error?: string };
    return data.error || message.Data;
  } catch {
    return message.Data;
  }
}

export async function connectWallet() {
  if (!window.arweaveWallet) throw new Error("Install or enable a compatible Arweave wallet first.");
  const required: string[] = ["ACCESS_ADDRESS", "SIGN_TRANSACTION", "DISPATCH"];
  const existing: string[] = await window.arweaveWallet.getPermissions().catch(() => []);
  const missing = required.filter((permission) => !existing.includes(permission));
  if (missing.length) await window.arweaveWallet.connect(required);
  return window.arweaveWallet.getActiveAddress();
}

export async function readRegistryProcess(): Promise<AoSnapshot | null> {
  if (!config.aoProcess) return null;
  const { dryrun } = await import("@permaweb/aoconnect");
  const response = await dryrun({
    process: config.aoProcess,
    tags: [{ name: "Action", value: "List" }],
    data: "",
  });
  return JSON.parse(extractData(response, "List-Result")) as AoSnapshot;
}

export async function sendRegistryAction(action: string, payload: Record<string, unknown>) {
  const process = requireProcess();
  if (!window.arweaveWallet) throw new Error("An Arweave wallet is required to sign this action.");
  await connectWallet();
  const { createDataItemSigner, message, result } = await import("@permaweb/aoconnect");
  const messageId = await message({
    process,
    signer: createDataItemSigner(window.arweaveWallet),
    tags: [
      { name: "Action", value: action },
      { name: "Data-Protocol", value: "ilxyr" },
      { name: "Schema", value: "ilxyr.registry-message.v1" },
    ],
    data: JSON.stringify(payload),
  });
  const response = await result({ process, message: messageId });
  const error = extractProcessError(response);
  if (error) throw new Error(error);
  extractData(response, `${action}-Result`);
  return { messageId, response };
}
