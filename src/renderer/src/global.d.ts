import type { AppApi } from "@shared/ipc";

declare module "*.svg" {
  const src: string;
  export default src;
}

declare global {
  interface Window {
    appApi: AppApi;
  }
}

export {};
