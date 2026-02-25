import { useUserStore } from '../../state/useUserStore';
import { useSolanaBalance } from '../../hooks/useSolanaBalance';
import { Coin, Wallet } from '@phosphor-icons/react';
import './CreditsDisplay.css';

export const CreditsDisplay = () => {
  const { user } = useUserStore();
  const { balance, isLoading } = useSolanaBalance();

  if (!user) return null;

  return (
    <div className="credits-display-container">
      <div className="credits-display xp-display" title="Your Rewards Balance">
        <Coin size={20} weight="duotone" color="#FFD700" />
        <span className="credits-amount xp-amount">{user.credits.toLocaleString()} XP</span>
      </div>
      
      {balance !== null && (
        <div className="credits-display sol-display" title="Your Solana Balance">
          <Wallet size={20} weight="duotone" color="#a855f7" />
          <span className="credits-amount sol-amount">
            {isLoading ? '...' : `${balance.toFixed(2)} SOL`}
          </span>
        </div>
      )}
    </div>
  );
};
