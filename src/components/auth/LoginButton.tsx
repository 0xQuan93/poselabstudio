import { User, SignOut } from '@phosphor-icons/react';
import { useUserStore } from '../../state/useUserStore';
import { useToastStore } from '../../state/useToastStore';
import { CreditsDisplay } from '../rewards/CreditsDisplay';
import { ProfileModal } from '../profile/ProfileModal';
import { useEffect, useState } from 'react';
import './LoginButton.css';

export const LoginButton = () => {
  const { user, setUser, logout: storeLogout } = useUserStore();
  const { addToast } = useToastStore();
  const [isProfileOpen, setIsProfileOpen] = useState(false);

  useEffect(() => {
    // Check for poselab_user cookie
    const getCookie = (name: string) => {
      const value = `; ${document.cookie}`;
      const parts = value.split(`; ${name}=`);
      if (parts.length === 2) return parts.pop()?.split(';').shift();
      return null;
    };

    const sessionCookie = getCookie('poselab_user');
    
    if (sessionCookie) {
      try {
        // Robust Base64 decoding for UTF-8 support (e.g. emojis in usernames)
        const binaryString = atob(sessionCookie);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        const decodedString = new TextDecoder().decode(bytes);
        const decoded = JSON.parse(decodedString);
        
        // Update store if user is not set or data changed
        if (!user || user.id !== decoded.id) {
          const currentLp = useUserStore.getState().user?.lp || 0;
          const lastLoginDate = useUserStore.getState().user?.lastLoginDate;
          const explorationMilestones = useUserStore.getState().user?.explorationMilestones || {};
          
          setUser({
            id: decoded.id,
            discordId: decoded.discordId,
            username: decoded.username,
            avatarUrl: decoded.avatarUrl,
            lp: currentLp,
            lastLoginDate,
            explorationMilestones
          });

          // Fetch fresh LP from the Discord channel backend
          if (decoded.discordId) {
            useUserStore.getState().fetchLpFromBot(decoded.discordId);
          }
          
          setTimeout(async () => {
            const reward = await useUserStore.getState().recordDailyLogin();
            if (reward > 0) {
              addToast(`Daily Login: +${reward} LP! 🔥`, 'success');
            }
          }, 1000); // Slight delay so toast doesn't get buried
        }
      } catch (err) {
        console.error('Failed to parse session cookie', err);
      }
    } else if (user) {
      // Cookie is gone, log out locally
      storeLogout();
    }
  }, [user, setUser, storeLogout, addToast]);

  const handleLogout = () => {
    // Delete cookie
    document.cookie = 'poselab_user=; Path=/; Expires=Thu, 01 Jan 1970 00:00:01 GMT;';
    storeLogout();
  };
  
  if (user) {
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
                <span>{user?.username || 'User'}</span>
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
    <a href="/api/auth/discord" className="login-btn" style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      Log In
    </a>
  );
};
