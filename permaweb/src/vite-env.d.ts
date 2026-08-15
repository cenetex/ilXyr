/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ARWEAVE_GATEWAY?: string;
  readonly VITE_ILXYR_PUBLISHERS?: string;
  readonly VITE_ILXYR_INDEX_TX?: string;
  readonly VITE_ILXYR_AO_PROCESS?: string;
  readonly VITE_ILXYR_ARNS_NAME?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ArweaveWallet {
  connect(permissions: string[]): Promise<void>;
  disconnect(): Promise<void>;
  getActiveAddress(): Promise<string>;
  getPermissions(): Promise<string[]>;
  signDataItem(input: unknown): Promise<ArrayBuffer>;
}

interface Window {
  arweaveWallet?: ArweaveWallet;
}
