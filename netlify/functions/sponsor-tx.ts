import { Handler } from '@netlify/functions';
import { Keypair, Transaction } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';

const TREASURY_PRIVATE_KEY = process.env.TREASURY_PRIVATE_KEY;

export const handler: Handler = async (event) => {
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method Not Allowed' };
  }

  try {
    const { transaction } = JSON.parse(event.body || '{}');

    if (!transaction) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Transaction is required' }) };
    }
    
    if (!TREASURY_PRIVATE_KEY) {
      console.error('TREASURY_PRIVATE_KEY is not configured on the server.');
      return { statusCode: 500, body: JSON.stringify({ error: 'Treasury not configured' }) };
    }

    let secretKey: Uint8Array;
    try {
      secretKey = Uint8Array.from(JSON.parse(TREASURY_PRIVATE_KEY));
    } catch (e) {
      return { statusCode: 500, body: JSON.stringify({ error: 'Invalid Treasury configuration' }) };
    }
    
    const treasuryKeypair = Keypair.fromSecretKey(secretKey);

    const txBuffer = Buffer.from(transaction, 'base64');
    const tx = Transaction.from(txBuffer);

    if (!tx.feePayer || !tx.feePayer.equals(treasuryKeypair.publicKey)) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Invalid fee payer' }) };
    }

    // --- INSTRUCTION VALIDATION SECURITY GATE ---
    // We only allow SPL Token Transfers and Associated Token Account creation
    // to prevent malicious actors from submitting arbitrary heavy transactions (e.g. deployments)
    const allowedPrograms = [
      TOKEN_PROGRAM_ID.toBase58(),
      ASSOCIATED_TOKEN_PROGRAM_ID.toBase58()
    ];

    for (const ix of tx.instructions) {
      const programIdStr = ix.programId.toBase58();
      
      if (!allowedPrograms.includes(programIdStr)) {
        console.error(`Rejected TX: Contains unauthorized program interaction (${programIdStr})`);
        return { 
          statusCode: 403, 
          body: JSON.stringify({ error: `Unauthorized program interaction: ${programIdStr}` }) 
        };
      }
    }
    // ------------------------------------------

    tx.partialSign(treasuryKeypair);

    const serializedTx = tx.serialize({ requireAllSignatures: false, verifySignatures: false });

    return {
      statusCode: 200,
      body: JSON.stringify({ transaction: serializedTx.toString('base64') }),
    };

  } catch (error) {
    console.error('Sponsor Tx Error:', error);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'Internal Server Error' }),
    };
  }
};
