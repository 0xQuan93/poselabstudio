import { usePrivy } from '@privy-io/react-auth';
import { User, SignOut, Gear } from '@phosphor-icons/react';
import { useUserStore } from '../../state/useUserStore';
import { CreditsDisplay } from '../rewards/CreditsDisplay';
import { ProfileModal } from '../profile/ProfileModal';
import { useEffect, useState } from 'react';
import './LoginButton.css';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3001';

export const LoginButton = () => {
  const { login, authenticated, user: privyUser, logout, getAccessToken } = usePrivy();
  const { user, setUser, logout: storeLogout } = useUserStore();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    const syncUser = async () => {
      if (authenticated && privyUser && !user) {
        try {
          const token = await getAccessToken();
          const response = await fetch(`${BACKEND_URL}/auth/login`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ token }),
          });
          
          if (response.ok) {
            const userData = await response.json();
            setUser({
              id: userData.id,
              username: userData.username,
              avatarUrl: userData.avatarUrl,
              credits: userData.credits || 0
            });
          }
        } catch (error) {
          console.error('Failed to sync user:', error);
        }
      } else if (!authenticated && user) {
        storeLogout();
      }
    };

    syncUser();
  }, [authenticated, privyUser, user, getAccessToken, setUser, storeLogout]);

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
