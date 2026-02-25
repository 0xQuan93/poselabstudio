import { Connection, Keypair, SystemProgram, Transaction, LAMPORTS_PER_SOL, sendAndConfirmTransaction } from '@solana/web3.js';

async function simulateTip() {
  console.log('--- Starting Tipping Simulation (Devnet) ---');
  
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  
  const sender = Keypair.generate();
  console.log(`1. Created Sender Wallet: ${sender.publicKey.toBase58()}`);
  
  console.log('   Requesting 1 SOL airdrop for Sender...');
  try {
    const airdropSignature = await connection.requestAirdrop(
      sender.publicKey,
      1 * LAMPORTS_PER_SOL
    );
    await connection.confirmTransaction(airdropSignature);
    console.log('   Airdrop successful!');
  } catch (err) {
    console.error('   Airdrop failed. Devnet might be rate-limited.');
    return;
  }

  const initialBalance = await connection.getBalance(sender.publicKey);
  console.log(`   Sender Balance: ${initialBalance / LAMPORTS_PER_SOL} SOL`);

  const creator = Keypair.generate();
  console.log(`2. Created Creator Wallet: ${creator.publicKey.toBase58()}`);

  const tipAmount = 0.1;
  console.log(`3. Executing Tip Transfer of ${tipAmount} SOL...`);
  
  const transaction = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey: sender.publicKey,
      toPubkey: creator.publicKey,
      lamports: tipAmount * LAMPORTS_PER_SOL,
    })
  );

  try {
    const signature = await sendAndConfirmTransaction(
      connection,
      transaction,
      [sender]
    );
    
    console.log(`   Success! Transaction Signature: ${signature}`);
    console.log(`   View on Explorer: https://explorer.solana.com/tx/${signature}?cluster=devnet`);
    
    const finalSenderBalance = await connection.getBalance(sender.publicKey);
    const finalCreatorBalance = await connection.getBalance(creator.publicKey);
    
    console.log(`4. Final Balances:`);
    console.log(`   Sender: ${finalSenderBalance / LAMPORTS_PER_SOL} SOL`);
    console.log(`   Creator: ${finalCreatorBalance / LAMPORTS_PER_SOL} SOL`);
    console.log('--- Simulation Complete ---');

  } catch (err) {
    console.error('   Transaction failed:', err);
  }
}

simulateTip();
