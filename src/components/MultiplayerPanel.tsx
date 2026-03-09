import { useState, useCallback, useEffect } from 'react';
import { useMultiplayerStore, useIsInSession, usePeerCount } from '../state/useMultiplayerStore';
import { useUserStore } from '../state/useUserStore';
import { peerManager } from '../multiplayer/peerManager';
import { syncManager } from '../multiplayer/syncManager';
import { useToastStore } from '../state/useToastStore';
import { VoiceChatControls } from './VoiceChatControls';
import './MultiplayerPanel.css';
import { 
  Users, 
  X, 
  Rocket, 
  Link, 
  Copy, 
  SignOut, 
  Crown, 
  User,
  Pencil,
  Check,
  Warning,
  Person,
  ArrowsClockwise
} from '@phosphor-icons/react';

interface MultiplayerPanelProps {
  /** Compact mode for viewport overlay */
  compact?: boolean;
}

export function MultiplayerPanel({ compact = false }: MultiplayerPanelProps) {
  const {
    roomId,
    role,
    isConnected,
    isConnecting,
    localDisplayName,
    peers,
    error,
    peerLatencies,
    setLocalDisplayName,
  } = useMultiplayerStore();

  const isInSession = useIsInSession();
  const peerCount = usePeerCount();
  const addToast = useToastStore((s) => s.addToast);

  const [joinRoomId, setJoinRoomId] = useState('');
  const [showJoinInput, setShowJoinInput] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [tempName, setTempName] = useState(localDisplayName);

  // Check for room ID in URL on mount
  useEffect(() => {
    const urlRoomId = peerManager.constructor.prototype.constructor.getRoomIdFromUrl?.() 
      ?? new URLSearchParams(window.location.search).get('room');
    
    if (urlRoomId && !isInSession && !isConnecting) {
      setJoinRoomId(urlRoomId);
      setShowJoinInput(true);
      addToast(`Session invite detected: ${urlRoomId}`, 'info');
    }
  }, []);

  const handleCreateSession = useCallback(async () => {
    try {
      const id = await peerManager.createSession(localDisplayName);
      syncManager.initialize();
      addToast('Session created! Share the link to invite others.', 'success');
      console.log('[MultiplayerPanel] Session created:', id);
      useUserStore.getState().recordGamifiedAction('first_multiplayer').then(reward => {
        if (reward > 0) {
          addToast(`+${reward} LP for starting your first multiplayer session!`, 'success');
        }
      });
    } catch (err) {
      console.error('[MultiplayerPanel] Failed to create session:', err);
      addToast(`Failed to create session: ${(err as Error).message}`, 'error');
    }
  }, [localDisplayName, addToast]);

  const handleJoinSession = useCallback(async () => {
    if (!joinRoomId.trim()) {
      addToast('Please enter a room ID', 'error');
      return;
    }

    try {
      // Initialize syncManager BEFORE joining so it can receive messages immediately
      syncManager.initialize();
      await peerManager.joinSession(joinRoomId.trim(), localDisplayName);
      // Clear room from URL after joining
      const url = new URL(window.location.href);
      url.searchParams.delete('room');
      window.history.replaceState({}, '', url.toString());

      useUserStore.getState().recordGamifiedAction('first_multiplayer').then(reward => {
        if (reward > 0) {
          addToast(`+${reward} LP for joining your first multiplayer session!`, 'success');
        }
      });
      
      addToast(`Joined session: ${joinRoomId}`, 'success');
      setShowJoinInput(false);
      setJoinRoomId('');
    } catch (err) {
      console.error('[MultiplayerPanel] Failed to join session:', err);
      syncManager.stop(); // Clean up on failure
      addToast(`Failed to join: ${(err as Error).message}`, 'error');
    }
  }, [joinRoomId, localDisplayName, addToast]);

  const handleLeaveSession = useCallback(() => {
    syncManager.stop();
    peerManager.leaveSession();
    addToast('Left session', 'info');
  }, [addToast]);

  const handleCopyLink = useCallback(() => {
    const url = peerManager.getSessionUrl();
    if (url) {
      navigator.clipboard.writeText(url).then(() => {
        addToast('Session link copied!', 'success');
      }).catch(() => {
        addToast('Failed to copy link', 'error');
      });
    }
  }, [addToast]);

  const handleSaveName = useCallback(() => {
    setLocalDisplayName(tempName.trim() || localDisplayName);
    setEditingName(false);
  }, [tempName, localDisplayName, setLocalDisplayName]);

  // Compact mode for viewport overlay
  if (compact) {
    return (
      <div className="multiplayer-compact">
        {isInSession ? (
          <>
            <VoiceChatControls compact />
            <div className="mp-status-badge connected" title={`Room: ${roomId}`}>
              <span className="mp-dot" />
              <span className="mp-count">{peerCount}</span>
              <button className="mp-leave-btn" onClick={handleLeaveSession} title="Leave Session">
                <X size={14} weight="bold" />
              </button>
            </div>
          </>
        ) : (
          <button 
            className="mp-quick-join"
            onClick={handleCreateSession}
            disabled={isConnecting}
            title="Start Co-op Session"
          >
            {isConnecting ? '...' : <Users size={18} weight="duotone" />}
          </button>
        )}
      </div>
    );
  }

  // Full panel mode
  return (
    <div className="multiplayer-panel">
      <div className="mp-header">
        <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}><Users size={18} weight="duotone" /> Co-op Session</h3>
        {isInSession && (
          <span className={`mp-status ${isConnected ? 'connected' : 'disconnected'}`}>
            {isConnected ? '● Connected' : '○ Disconnected'}
          </span>
        )}
      </div>

      {error && (
        <div className="mp-error" style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <Warning size={14} weight="duotone" /> {error}
        </div>
      )}

      {/* Display Name */}
      <div className="mp-section">
        <label className="mp-label">Your Name</label>
        {editingName ? (
          <div className="mp-name-edit">
            <input
              type="text"
              value={tempName}
              onChange={(e) => setTempName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSaveName()}
              autoFocus
              maxLength={20}
            />
            <button onClick={handleSaveName}><Check size={14} weight="bold" /></button>
            <button onClick={() => { setEditingName(false); setTempName(localDisplayName); }}><X size={14} weight="bold" /></button>
          </div>
        ) : (
          <div className="mp-name-display" onClick={() => { setEditingName(true); setTempName(localDisplayName); }}>
            <span>{localDisplayName}</span>
            <span className="mp-edit-hint"><Pencil size={12} weight="duotone" /></span>
          </div>
        )}
      </div>

      {!isInSession ? (
        // Not in session - show create/join options
        <div className="mp-actions">
          <button 
            className="mp-btn primary"
            onClick={handleCreateSession}
            disabled={isConnecting}
          >
            {isConnecting ? 'Connecting...' : <><Rocket size={16} weight="duotone" /> Create Session</>}
          </button>

          {showJoinInput ? (
            <div className="mp-join-form">
              <input
                type="text"
                placeholder="Enter room ID (e.g., swift-phoenix-042)"
                value={joinRoomId}
                onChange={(e) => setJoinRoomId(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleJoinSession()}
                disabled={isConnecting}
              />
              <div className="mp-join-buttons">
                <button 
                  className="mp-btn primary"
                  onClick={handleJoinSession}
                  disabled={isConnecting || !joinRoomId.trim()}
                >
                  Join
                </button>
                <button 
                  className="mp-btn secondary"
                  onClick={() => { setShowJoinInput(false); setJoinRoomId(''); }}
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button 
              className="mp-btn secondary"
              onClick={() => setShowJoinInput(true)}
              disabled={isConnecting}
            >
              <Link size={16} weight="duotone" /> Join Session
            </button>
          )}
        </div>
      ) : (
        // In session - show session info and peers
        <>
          <div className="mp-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <label className="mp-label">Room ID</label>
              <button 
                className="mp-btn secondary small" 
                onClick={() => syncManager.broadcastFullState()}
                title="Sync state with all peers"
                style={{ padding: '4px 8px', fontSize: '0.7rem' }}
              >
                <ArrowsClockwise size={12} weight="bold" /> Sync Now
              </button>
            </div>
            <div className="mp-room-info">
              <code className="mp-room-id">{roomId}</code>
              <span className="mp-role">{role === 'host' ? <><Crown size={14} weight="fill" /> Host</> : <><User size={14} weight="duotone" /> Guest</>}</span>
            </div>
            <button className="mp-btn secondary small" onClick={handleCopyLink}>
              <Copy size={14} weight="duotone" /> Copy Invite Link
            </button>
          </div>

          <div className="mp-section">
            <label className="mp-label">Connected ({peerCount})</label>
            <div className="mp-peers-list">
              {Array.from(peers.values()).map((peer) => (
                <div 
                  key={peer.peerId} 
                  className={`mp-peer ${peer.isLocal ? 'local' : ''} ${peer.connectionState}`}
                >
                  <span className="mp-peer-avatar">
                    {peer.hasAvatar ? <Person size={16} weight="duotone" /> : <User size={16} weight="duotone" />}
                  </span>
                  <span className="mp-peer-name">
                    {peer.displayName}
                    {peer.isLocal && <span className="mp-you">(you)</span>}
                  </span>
                  {!peer.isLocal && peerLatencies.has(peer.peerId) && (
                    <span className="mp-peer-latency">
                      {peerLatencies.get(peer.peerId)}ms
                    </span>
                  )}
                  <span className={`mp-peer-status ${peer.connectionState}`}>
                    {peer.connectionState === 'connected' ? '●' : '○'}
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Voice Chat Controls */}
          <div className="mp-section">
            <VoiceChatControls />
          </div>

          <button className="mp-btn danger" onClick={handleLeaveSession}>
            <SignOut size={16} weight="duotone" /> Leave Session
          </button>
        </>
      )}

      <div className="mp-footer">
        <small>
          Peer-to-peer connection • No server storage
        </small>
      </div>
    </div>
  );
}

