import { Handler } from '@netlify/functions';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { getOrCreateAssociatedTokenAccount, createTransferInstruction, getAssociatedTokenAddress } from '@solana/spl-token';

const SOLANA_RPC_URL = process.env.VITE_SOLANA_RPC_URL || process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;
const REWARD_TOKEN_MINT = process.env.VITE_REWARD_TOKEN_MINT;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { address, xpAmount } = JSON.parse(event.body || '{}');

    if (!address || !xpAmount || xpAmount <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid parameters' }) };
    }

    if (!TREASURY_PRIVATE_KEY || !REWARD_TOKEN_MINT) {
      console.error('Missing Treasury Key or Reward Token Mint in env.');
      return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    // Parse the private key array
    let secretKeyArray: Uint8Array;
    try {
      secretKeyArray = Uint8Array.from(JSON.parse(TREASURY_PRIVATE_KEY));
    } catch (e) {
       console.error('Failed to parse TREASURY_PRIVATE_KEY. Ensure it is a valid JSON array.');
       return { statusCode: 500, body: JSON.stringify({ error: 'Server configuration error' }) };
    }

    const treasuryKeypair = Keypair.fromSecretKey(secretKeyArray);
    const connection = new Connection(SOLANA_RPC_URL, 'confirmed');
    const recipientPubKey = new PublicKey(address);
    const mintPubKey = new PublicKey(REWARD_TOKEN_MINT);

    // Conversion rate: 100 XP = 1 $STUDIO. Assuming token has 9 decimals.
    const decimals = 9;
    const tokensToMint = xpAmount / 100;
    const amountToTransfer = Math.floor(tokensToMint * Math.pow(10, decimals));

    if (amountToTransfer <= 0) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Minimum of 100 XP required to claim' }) };
    }

    // Get the treasury's ATA (it must already exist and have tokens)
    const treasuryAta = await getAssociatedTokenAddress(mintPubKey, treasuryKeypair.publicKey);

    // Get or create the recipient's ATA
    // The treasury pays for the rent to create the ATA if it doesn't exist
    const recipientAta = await getOrCreateAssociatedTokenAccount(
      connection,
      treasuryKeypair, // Payer
      mintPubKey,
      recipientPubKey
    );

    // Create transfer instruction
    const transferIx = createTransferInstruction(
      treasuryAta,
      recipientAta.address,
      treasuryKeypair.publicKey,
      amountToTransfer
    );

    const transaction = new Transaction().add(transferIx);
    
    const signature = await sendAndConfirmTransaction(connection, transaction, [treasuryKeypair]);

    return {
      statusCode: 200,
      body: JSON.stringify({ success: true, signature, tokensClaimed: tokensToMint })
    };

  } catch (error: any) {
    console.error('Claim Rewards Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: error.message || 'Internal Server Error' })
    };
  }
};
