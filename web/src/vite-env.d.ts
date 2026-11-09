/// <reference types="vite/client" />

/* eslint-disable @typescript-eslint/no-unused-vars -- ambient type augmentations */

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string;
}

interface FacebookAuthResponse {
  code?: string;
  accessToken?: string;
  userID?: string;
}
interface FacebookLoginResponse {
  authResponse?: FacebookAuthResponse | null;
  status?: string;
}
interface FacebookSdk {
  init(options: { appId: string; autoLogAppEvents?: boolean; xfbml?: boolean; version: string }): void;
  login(callback: (response: FacebookLoginResponse) => void, options: {
    config_id: string; response_type: 'code'; override_default_response_type: true;
    extras?: { setup?: Record<string, unknown>; featureType?: string; sessionInfoVersion?: string };
  }): void;
}
declare global {
  interface Window {
    FB?: FacebookSdk;
    fbAsyncInit?: () => void;
  }
}
export {};
