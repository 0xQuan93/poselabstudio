import { useState, useEffect } from 'react';
import { useMultiplayerStore } from '../state/useMultiplayerStore';
import { Link, UploadSimple, DownloadSimple, CheckCircle, XCircle } from '@phosphor-icons/react';
import './ConnectionProgressPanel.css';

interface TransferProgress {
  peerId: string;
  displayName: string;
  direction: 'sending' | 'receiving';
  chunksComplete: number;
  totalChunks: number;
  status: 'pending' | 'transferring' | 'loading' | 'complete' | 'error';
}

// Global state for transfer progress (accessible from syncManager)
let progressListeners: ((progress: Map<string, TransferProgress>) => void)[] = [];
const transferProgressMap = new Map<string, TransferProgress>();

export function notifyTransferProgress(progress: TransferProgress) {
  transferProgressMap.set(progress.peerId, progress);
  progressListeners.forEach(listener => listener(new Map(transferProgressMap)));
}

export function clearTransferProgress(peerId: string) {
  transferProgressMap.delete(peerId);
  progressListeners.forEach(listener => listener(new Map(transferProgressMap)));
}

export function clearAllTransferProgress() {
  transferProgressMap.clear();
  progressListeners.forEach(listener => listener(new Map(transferProgressMap)));
}

export function ConnectionProgressPanel() {
  const { isConnecting, isConnected, role, peers } = useMultiplayerStore();
  const [transfers, setTransfers] = useState<Map<string, TransferProgress>>(new Map());
  const [isVisible, setIsVisible] = useState(false);
  const [showComplete, setShowComplete] = useState(false);

  // Subscribe to transfer progress updates
  useEffect(() => {
    const listener = (progress: Map<string, TransferProgress>) => {
      setTransfers(progress);
    };
    progressListeners.push(listener);
    
    return () => {
      progressListeners = progressListeners.filter(l => l !== listener);
    };
  }, []);

  // Show panel when connecting or when there are active transfers
  useEffect(() => {
    const hasActiveTransfers = Array.from(transfers.values()).some(
      t => t.status === 'pending' || t.status === 'transferring' || t.status === 'loading'
    );
    
    const hasRecentComplete = Array.from(transfers.values()).some(
      t => t.status === 'complete'
    );

    if (isConnecting || hasActiveTransfers) {
      setIsVisible(true);
      setShowComplete(false);
    } else if (hasRecentComplete && !showComplete) {
      // Show completion briefly
      setShowComplete(true);
      setTimeout(() => {
        setIsVisible(false);
        clearAllTransferProgress();
      }, 2000);
    } else if (!hasActiveTransfers && !hasRecentComplete) {
      setIsVisible(false);
    }
  }, [isConnecting, transfers, showComplete]);

  if (!isVisible) return null;

  const transferList = Array.from(transfers.values());
  const peerCount = peers.size;

  return (
    <div className="connection-progress-panel">
      <div className="progress-header">
        <span className="progress-icon">
          <Link size={20} weight="bold" />
        </span>
        <span className="progress-title">
          {isConnecting ? 'Connecting...' : 
           showComplete ? 'Connected!' :
           role === 'host' ? 'Syncing with guests...' : 'Syncing with host...'}
        </span>
      </div>

      {isConnecting && (
        <div className="progress-item">
          <div className="progress-label">Establishing connection...</div>
          <div className="progress-bar-container">
            <div className="progress-bar indeterminate" />
          </div>
        </div>
      )}

      {isConnected && peerCount > 1 && (
        <div className="progress-status">
          <span className="status-dot connected" />
          <span>{peerCount} peers connected</span>
        </div>
      )}

      {transferList.map(transfer => (
        <div key={transfer.peerId} className="progress-item">
          <div className="progress-label">
            <span className="transfer-direction">
              {transfer.direction === 'sending' ? (
                <UploadSimple size={16} weight="bold" />
              ) : (
                <DownloadSimple size={16} weight="bold" />
              )}
            </span>
            <span className="transfer-name">{transfer.displayName}</span>
            <span className="transfer-status">
              {transfer.status === 'pending' && 'Waiting...'}
              {transfer.status === 'transferring' && 'Transferring avatar...'}
              {transfer.status === 'loading' && 'Loading model...'}
              {transfer.status === 'complete' && (
                <span className="status-ready">
                  <CheckCircle size={14} weight="fill" /> Ready
                </span>
              )}
              {transfer.status === 'error' && (
                <span className="status-failed">
                  <XCircle size={14} weight="fill" /> Failed
                </span>
              )}
            </span>
          </div>
          <div className="progress-bar-container">
            <div 
              className={`progress-bar ${transfer.status}`}
              style={{ 
                width: transfer.status === 'complete' ? '100%' :
                       transfer.totalChunks > 0 
                         ? `${(transfer.chunksComplete / transfer.totalChunks) * 100}%` 
                         : '0%'
              }}
            />
          </div>
          {transfer.status === 'transferring' && transfer.totalChunks > 0 && (
            <div className="progress-percent">
              {Math.round((transfer.chunksComplete / transfer.totalChunks) * 100)}%
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

