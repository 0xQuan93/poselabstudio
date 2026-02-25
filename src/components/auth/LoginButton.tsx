import { usePrivy } from '@privy-io/react-auth';
import { User, SignOut } from '@phosphor-icons/react';
import { useUserStore } from '../../state/useUserStore';
import { CreditsDisplay } from '../rewards/CreditsDisplay';
import { ProfileModal } from '../profile/ProfileModal';
import { useEffect, useState } from 'react';
import './LoginButton.css';

export const LoginButton = () => {
  const { login, authenticated, user: privyUser, logout } = usePrivy();
  const { user, setUser, logout: storeLogout } = useUserStore();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    const syncUser = () => {
      if (authenticated && privyUser && !user) {
        // Extract username/avatar from Privy user data
        // Priority: Discord profile > Email > ID
        const discordAccount = privyUser.linkedAccounts.find(a => a.type === 'discord_oauth') as any;
        
        setUser({
          id: privyUser.id,
          username: discordAccount?.username || privyUser.email?.address?.split('@')[0] || 'User',
          avatarUrl: discordAccount?.profile_picture_url || null,
          credits: 0 // Default to 0, or load from localStorage/on-chain later
        });
      } else if (!authenticated && user) {
        storeLogout();
      }
    };

    syncUser();
  }, [authenticated, privyUser, user, setUser, storeLogout]);

  const handleLogout = async () => {
    await logout();
    storeLogout();
  };
  
  if (authenticated) {
    return (
      <>
        <div className="user-menu-container">
          <CreditsDisplay />
          <div className="user-menu">
            <button 
              className="user-info-btn" 
              onClick={() => setIsProfileOpen(true)}
              title="Edit Profile"
            >
                <div className="user-avatar-small">
                  {user?.avatarUrl ? (
                    <img src={user.avatarUrl} alt="avatar" />
                  ) : (
                    <User size={20} />
                  )}
                </div>
                <span>{user?.username || privyUser?.email?.address?.split('@')[0] || 'User'}</span>
            </button>
            <button onClick={handleLogout} className="logout-btn" title="Sign Out">
              <SignOut size={20} />
            </button>
          </div>
        </div>
        <ProfileModal isOpen={isProfileOpen} onClose={() => setIsProfileOpen(false)} />
      </>
    );
  }

  return (
    <button onClick={login} className="login-btn">
      Log In
    </button>
  );
};
