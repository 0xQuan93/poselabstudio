import { useUserStore } from '../../state/useUserStore';
import { Coin } from '@phosphor-icons/react';
import './CreditsDisplay.css';

export const CreditsDisplay = () => {
  const { user } = useUserStore();

  if (!user) return null;

  return (
    <div className="credits-display" title="Your Rewards Balance">
      <Coin size={20} weight="duotone" color="#FFD700" />
      <span className="credits-amount">{user.credits.toLocaleString()} XP</span>
    </div>
  );
};
