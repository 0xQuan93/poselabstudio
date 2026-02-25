import { useState } from 'react';
import { useUserStore } from '../../state/useUserStore';
import { X, DiscordLogo, Wallet, Copy } from '@phosphor-icons/react';
import { isEmbeddedApp } from '../../hooks/useDiscordActivity';
import { useSolanaWallets } from '@privy-io/react-auth';
import { useSolanaBalance } from '../../hooks/useSolanaBalance';
import { TipCreatorModal } from '../rewards/TipCreatorModal';
import './ProfileModal.css';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal = ({ isOpen, onClose }: ProfileModalProps) => {
  const { user } = useUserStore();
  const { wallets } = useSolanaWallets();
  const { balance } = useSolanaBalance();
  const [isTipModalOpen, setIsTipModalOpen] = useState(false);

  // Find the embedded wallet or the first available wallet
  const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];

  const handleCopyAddress = () => {
    if (wallet?.address) {
      navigator.clipboard.writeText(wallet.address);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content">
        <div className="modal-header">
          <h2>Discord Profile</h2>
          <button onClick={onClose} className="close-btn"><X size={24} /></button>
        </div>
        
        <div className="modal-body">
          {user ? (
            <div className="profile-info-display">
              <div className="profile-avatar-large">
                {user.avatarUrl ? (
                  <img src={user.avatarUrl} alt={user.username || 'User'} />
                ) : (
                  <DiscordLogo size={64} />
                )}
              </div>
              <h3 className="profile-username">{user.username}</h3>
              <p className="profile-id">ID: {user.id}</p>
              
              <div className="profile-stats">
                <div className="stat-card">
                  <span className="stat-label">XP Credits</span>
                  <span className="stat-value">{user.credits?.toLocaleString() || 0}</span>
                </div>
                {balance !== null && (
                  <div className="stat-card">
                    <span className="stat-label">Solana Balance</span>
                    <span className="stat-value sol-text" style={{ color: '#a855f7' }}>
                      {balance.toFixed(2)} SOL
                    </span>
                  </div>
                )}
              </div>

              {isEmbeddedApp && (
                <div className="discord-managed-notice">
                  <DiscordLogo size={16} />
                  <span>Profile managed by Discord Activity</span>
                </div>
              )}
              
              {wallet ? (
                <div className="wallet-section-active" style={{ marginTop: '20px', padding: '15px', border: '1px solid #444', borderRadius: '8px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <Wallet size={20} color="#a855f7" />
                      <span style={{ fontWeight: 500 }}>Embedded Wallet</span>
                    </div>
                    <button 
                      onClick={handleCopyAddress} 
                      style={{ background: 'transparent', border: 'none', color: '#888', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '4px' }}
                      title="Copy Address"
                    >
                      <Copy size={16} /> <span style={{ fontSize: '12px' }}>Copy</span>
                    </button>
                  </div>
                  <div style={{ fontFamily: 'monospace', fontSize: '12px', wordBreak: 'break-all', color: '#aaa', backgroundColor: '#111', padding: '8px', borderRadius: '4px' }}>
                    {wallet.address}
                  </div>
                  <button 
                    onClick={() => setIsTipModalOpen(true)}
                    style={{ marginTop: '12px', width: '100%', background: '#a855f7', color: 'white', border: 'none', padding: '8px', borderRadius: '4px', cursor: 'pointer', fontWeight: 600, transition: 'background 0.2s' }}
                    onMouseOver={(e) => e.currentTarget.style.background = '#9333ea'}
                    onMouseOut={(e) => e.currentTarget.style.background = '#a855f7'}
                  >
                    Test Send Tip (Self)
                  </button>
                </div>
              ) : (
                <div className="wallet-section-placeholder" style={{ marginTop: '20px', padding: '15px', border: '1px solid #333', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                   <Wallet size={24} color="#a855f7" />
                   <span>No Solana wallet connected. Please log in.</span>
                </div>
              )}
            </div>
          ) : (
            <div className="profile-not-loaded">
              <p>Profile information is loading or unavailable.</p>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button onClick={onClose} className="save-btn">Close</button>
        </div>
      </div>
      
      {wallet && (
        <TipCreatorModal 
          isOpen={isTipModalOpen} 
          onClose={() => setIsTipModalOpen(false)} 
          creatorName={user?.username || 'Creator'} 
          creatorAddress={wallet.address} // Self-tipping for test purposes
        />
      )}
    </div>
  );
};
