import { useUserStore } from '../../state/useUserStore';
import { Coin } from '@phosphor-icons/react';
import './CreditsDisplay.css';

export const CreditsDisplay = () => {
  const { user } = useUserStore();

  if (!user) return null;

  return (
    <div className="credits-display-container">
      <div className="credits-display xp-display" title="Your Lab Points">
        <Coin size={20} weight="duotone" color="#FFD700" />
        <span className="credits-amount xp-amount">{user.lp.toLocaleString()} LP</span>
      </div>
    </div>
  );
};
