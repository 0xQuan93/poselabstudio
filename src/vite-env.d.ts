/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ENABLE_ARKIT_FACE_BRIDGE?: string;
  readonly VITE_ENABLE_VMC_BRIDGE?: string;
  readonly VITE_ENABLE_POSE_EXPORT?: string;
  readonly VITE_DISCORD_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
