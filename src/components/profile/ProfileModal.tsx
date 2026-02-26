import { useUserStore } from '../../state/useUserStore';
import { X, DiscordLogo } from '@phosphor-icons/react';
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
              
              <div className="profile-stats">
                <div className="stat-card">
                  <span className="stat-label">Lab Points (LP)</span>
                  <span className="stat-value">{user.lp?.toLocaleString() || 0}</span>
                </div>
              </div>

              {isEmbeddedApp && (
                <div className="discord-managed-notice">
                  <DiscordLogo size={16} />
                  <span>Profile managed by Discord Activity</span>
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
    </div>
  );
};
