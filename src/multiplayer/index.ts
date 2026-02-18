// Export LiveKitManager as peerManager to serve as a drop-in replacement
import { liveKitManager } from './livekitManager';

export const peerManager = liveKitManager;

// Re-export other managers
export { voiceChatManager } from './voiceChatManager';
export { syncManager } from './syncManager';
export { socialManager } from './socialManager';
