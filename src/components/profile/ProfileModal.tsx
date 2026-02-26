import { useUserStore } from '../../state/useUserStore';
import { X, DiscordLogo, Medal, Circuitry, Lightning } from '@phosphor-icons/react';
import { isEmbeddedApp } from '../../hooks/useDiscordActivity';
import './ProfileModal.css';

interface ProfileModalProps {
  isOpen: boolean;
  onClose: () => void;
}

const ROLE_DEFINITIONS = [
  { id: import.meta.env.VITE_DISCORD_ROLE_ID_STUDIO_TECH, name: 'Studio Tech', color: '#ffd700', icon: <Medal size={20} weight="fill" /> }, // Gold
  { id: import.meta.env.VITE_DISCORD_ROLE_ID_LAB_TECH, name: 'Lab Tech', color: '#c0c0c0', icon: <Circuitry size={20} weight="bold" /> }, // Silver
  { id: import.meta.env.VITE_DISCORD_ROLE_ID_GENERAL_TECH, name: 'General Tech', color: '#cd7f32', icon: <Lightning size={20} weight="bold" /> } // Bronze
];

export const ProfileModal = ({ isOpen, onClose }: ProfileModalProps) => {
  const { user } = useUserStore();

  if (!isOpen) return null;

  const lp = user?.lp || 0;
  const currentLevel = Math.floor(lp / 100) + 1;
  const progress = lp % 100;
  
  // Find highest role
  const userRoles = user?.roles || [];
  const currentRole = ROLE_DEFINITIONS.find(r => userRoles.includes(r.id));

  return (
    <div className="modal-backdrop">
      <div className="modal-content profile-modal">
        <div className="modal-header">
          <h2><DiscordLogo size={24} weight="fill" className="discord-icon"/> Creator Profile</h2>
          <button onClick={onClose} className="close-btn"><X size={24} /></button>
        </div>
        
        <div className="modal-body">
          {user ? (
            <div className="profile-info-display">
              <div className="profile-header-section">
                <div className="profile-avatar-large">
                  {user.avatarUrl ? (
                    <img src={user.avatarUrl} alt={user.username || 'User'} />
                  ) : (
                    <div className="avatar-placeholder">{user.username?.charAt(0) || 'U'}</div>
                  )}
                  <div className="level-badge">{currentLevel}</div>
                </div>
                
                <div className="profile-identity">
                  <h3 className="profile-username">{user.username}</h3>
                  {currentRole ? (
                    <div className="role-badge" style={{ borderColor: currentRole.color, color: currentRole.color }}>
                      {currentRole.icon}
                      <span>{currentRole.name}</span>
                    </div>
                  ) : (
                    <div className="role-badge initiate">
                      <span>Initiate</span>
                    </div>
                  )}
                </div>
              </div>
              
              <div className="profile-stats-container">
                <div className="progress-section">
                  <div className="progress-label">
                    <span>Level Progress</span>
                    <span>{progress} / 100 LP</span>
                  </div>
                  <div className="progress-bar-track">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                  </div>
                  <p className="next-level-hint">
                    {100 - progress} LP until Level {currentLevel + 1}
                  </p>
                </div>

                <div className="stats-grid">
                  <div className="stat-card">
                    <span className="stat-value">{lp.toLocaleString()}</span>
                    <span className="stat-label">Total Lab Points</span>
                  </div>
                  <div className="stat-card">
                    <span className="stat-value">{user.discordId ? 'Linked' : 'Local'}</span>
                    <span className="stat-label">Account Status</span>
                  </div>
                </div>
              </div>

              {isEmbeddedApp && (
                <div className="discord-managed-notice">
                  <DiscordLogo size={16} />
                  <span>Profile synced with Discord Activity</span>
                </div>
              )}
              
            </div>
          ) : (
            <div className="profile-not-loaded">
              <p>Profile information is loading...</p>
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
