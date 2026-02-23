import { useUserStore } from '../../state/useUserStore';
import { X, DiscordLogo, Wallet } from '@phosphor-icons/react';
import { isEmbeddedApp } from '../../hooks/useDiscordActivity';
import './ProfileModal.css';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ProfileModal = ({ isOpen, onClose }: ProfileModalProps) => {
  const { user } = useUserStore();

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
              </div>

              {isEmbeddedApp && (
                <div className="discord-managed-notice">
                  <DiscordLogo size={16} />
                  <span>Profile managed by Discord Activity</span>
                </div>
              )}
              
              {/* Future Solana Wallet integration section can go here */}
              <div className="wallet-section-placeholder" style={{ marginTop: '20px', padding: '15px', border: '1px solid #333', borderRadius: '8px', display: 'flex', alignItems: 'center', gap: '10px' }}>
                 <Wallet size={24} color="#a855f7" />
                 <span>Solana Wallet connection coming soon...</span>
              </div>
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
    </div>
  );
};
