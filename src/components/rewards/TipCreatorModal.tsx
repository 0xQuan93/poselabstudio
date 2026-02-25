import { useState } from 'react';
import { usePrivy, useSolanaWallets } from '@privy-io/react-auth';
import { Connection, PublicKey, Transaction } from '@solana/web3.js';
import { getAssociatedTokenAddress, createTransferInstruction, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { X, Coin, SpinnerGap } from '@phosphor-icons/react';
import './TipCreatorModal.css';

interface TipCreatorModalProps {
  isOpen: boolean;
  onClose: () => void;
  creatorName: string;
  creatorAddress: string;
}

const REWARD_TOKEN_MINT = import.meta.env.VITE_REWARD_TOKEN_MINT;
const TREASURY_PUBLIC_KEY = import.meta.env.VITE_TREASURY_PUBLIC_KEY;

export const TipCreatorModal = ({ isOpen, onClose, creatorName, creatorAddress }: TipCreatorModalProps) => {
  const [amount, setAmount] = useState<string>('');
  const [isSending, setIsSending] = useState(false);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const { authenticated } = usePrivy();
  const { wallets } = useSolanaWallets();

  // Find the embedded wallet or the first available wallet
  const wallet = wallets.find((w) => w.walletClientType === 'privy') || wallets[0];

  const handleTip = async () => {
    if (!authenticated || !wallet) {
      setError("Please connect your wallet first. Ensure you are logged in.");
      return;
    }

    if (!REWARD_TOKEN_MINT || !TREASURY_PUBLIC_KEY) {
      setError("Reward token or Treasury is not configured. Check environment variables.");
      return;
    }

    const tipAmount = parseFloat(amount);
    if (isNaN(tipAmount) || tipAmount <= 0) {
      setError("Please enter a valid tip amount.");
      return;
    }

    try {
      setIsSending(true);
      setError(null);
      setTxHash(null);

      // Using devnet for safety and development
      const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

      const senderPubkey = new PublicKey(wallet.address);
      const recipientPubkey = new PublicKey(creatorAddress);
      const mintPubkey = new PublicKey(REWARD_TOKEN_MINT);
      const treasuryPubkey = new PublicKey(TREASURY_PUBLIC_KEY);

      const senderATA = await getAssociatedTokenAddress(mintPubkey, senderPubkey);
      const recipientATA = await getAssociatedTokenAddress(mintPubkey, recipientPubkey);

      const transaction = new Transaction();

      // Check if recipient ATA exists
      const recipientAccountInfo = await connection.getAccountInfo(recipientATA);
      if (!recipientAccountInfo) {
        // Create ATA instruction (fee payer is treasury)
        transaction.add(
          createAssociatedTokenAccountInstruction(
            treasuryPubkey, // payer
            recipientATA, // ata
            recipientPubkey, // owner
            mintPubkey // mint
          )
        );
      }

      // Assuming 9 decimals for the token
      const decimals = 9; 
      const amountInSmallestUnit = BigInt(Math.floor(tipAmount * Math.pow(10, decimals)));

      transaction.add(
        createTransferInstruction(
          senderATA,
          recipientATA,
          senderPubkey,
          amountInSmallestUnit,
          [],
          TOKEN_PROGRAM_ID
        )
      );

      transaction.feePayer = treasuryPubkey;
      const networkInfo = await connection.getLatestBlockhash();
      transaction.recentBlockhash = networkInfo.blockhash;

      // Serialize unsigned/partially-signed transaction
      const serializedTx = transaction.serialize({ requireAllSignatures: false, verifySignatures: false });

      // Send to backend for treasury signature (Gasless execution)
      const response = await fetch('/.netlify/functions/sponsor-tx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ transaction: serializedTx.toString('base64') }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to get treasury signature');
      }

      const { transaction: sponsoredTxBase64 } = await response.json();
      const sponsoredTxBuffer = Buffer.from(sponsoredTxBase64, 'base64');
      const sponsoredTx = Transaction.from(sponsoredTxBuffer);

      // The Privy wallet will sign the transaction (as the sender) and broadcast it
      const signature = await wallet.sendTransaction(sponsoredTx, connection);
      setTxHash(signature);
    } catch (err: any) {
      console.error("Tipping error:", err);
      setError(err.message || "Failed to send tip");
    } finally {
      setIsSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-content tip-modal-content">
        <div className="modal-header">
          <h2>Tip {creatorName}</h2>
          <button onClick={onClose} className="close-btn" disabled={isSending}>
            <X size={24} />
          </button>
        </div>
        
        <div className="modal-body">
          <p className="tip-description">
            Show your appreciation! Your tip will be sent as a Gasless SPL Token transfer on Devnet.
          </p>

          <div className="tip-input-group">
            <Coin size={28} color="#FFD700" weight="duotone" />
            <input 
              type="number" 
              placeholder="0.00" 
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              min="0"
              step="0.01"
              disabled={isSending || txHash !== null}
            />
            <span className="currency-label">TOKEN</span>
          </div>

          {error && <div className="tip-error">{error}</div>}
          
          {txHash && (
            <div className="tip-success">
              <p>Tip sent successfully!</p>
              <a href={`https://explorer.solana.com/tx/${txHash}?cluster=devnet`} target="_blank" rel="noopener noreferrer">
                View Transaction on Explorer
              </a>
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button 
            onClick={handleTip} 
            className="save-btn tip-btn" 
            disabled={isSending || txHash !== null || !amount || parseFloat(amount) <= 0}
          >
            {isSending ? (
              <span className="flex-center"><SpinnerGap className="spinner" size={20} /> Sending...</span>
            ) : (
              'Send Tip'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};