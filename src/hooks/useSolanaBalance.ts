import { useState, useEffect } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { getAssociatedTokenAddress } from '@solana/spl-token';

const REWARD_TOKEN_MINT = import.meta.env.VITE_REWARD_TOKEN_MINT;

export const useSolanaBalance = () => {
  const [balance, setBalance] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  const { authenticated } = usePrivy();
  const { wallets } = useSolanaWallets();

  useEffect(() => {
    let isMounted = true;

    const fetchBalance = async () => {
      if (!authenticated || wallets.length === 0) {
        if (isMounted) setBalance(null);
        return;
      }

      const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];
      
      try {
        if (isMounted) {
          setIsLoading(true);
          setError(null);
        }

        const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
        const pubKey = new PublicKey(wallet.address);
        
        if (REWARD_TOKEN_MINT) {
          // Fetch SPL Token Balance
          const mintPubkey = new PublicKey(REWARD_TOKEN_MINT);
          const ata = await getAssociatedTokenAddress(mintPubkey, pubKey);
          
          try {
            const tokenAccountInfo = await connection.getTokenAccountBalance(ata);
            if (isMounted && tokenAccountInfo.value.uiAmount !== null) {
              setBalance(tokenAccountInfo.value.uiAmount);
            }
          } catch (e: any) {
            // Account might not exist yet (0 balance)
            if (e.message.includes('could not find account')) {
              if (isMounted) setBalance(0);
            } else {
              throw e;
            }
          }
        } else {
          // Fallback to Native SOL balance
          const lamports = await connection.getBalance(pubKey);
          if (isMounted) {
            setBalance(lamports / LAMPORTS_PER_SOL);
          }
        }
      } catch (err: any) {
        console.error("Failed to fetch balance:", err);
        if (isMounted) {
          setError(err.message || 'Error fetching balance');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    fetchBalance();
    
    const intervalId = setInterval(fetchBalance, 15000);

    return () => {
      isMounted = false;
      clearInterval(intervalId);
    };
  }, [authenticated, wallets]);

  return { balance, isLoading, error };
};
