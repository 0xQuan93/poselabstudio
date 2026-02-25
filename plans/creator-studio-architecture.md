# Architecture Plan: Studio & Creator Rewards

## 1. Core Philosophy
The "Studio" is designed exclusively to empower the Creator Rewards program. It operates entirely without a traditional database or Node.js backend. Instead, it leverages:
- **Discord SDK:** For identity, distribution, and potentially acting as the "database" for social interactions.
- **Privy:** For frictionless, invisible Solana embedded wallets tied to Discord logins.
- **Solana SDK:** The blockchain acts as the ledger for ownership, tipping, and the token economy.

## 2. Tokenomics & The Treasury
- **XP to Token Parallelism:** The UI will display XP (earned via app usage/engagement) parallel to the actual Solana token balance.
- **The Treasury:** A central wallet containing a reserve (e.g., 5% of the total token supply). This treasury can be used to automatically convert users' earned XP into real tokens at set intervals, or to subsidize gas fees.
- **Gasless Transactions:** Privy will handle transaction signing. To ensure users don't need raw SOL just to send a tip, we can implement a "Fee Payer" (Paymaster) pattern where a backend key (or the Treasury) sponsors the transaction fees, while the user's Privy wallet signs the actual transfer of the reward tokens.

## 3. Social Mechanics (The Backend-less Strategy)

To achieve a Feed, Upvoting, and Following without a traditional database, we have two primary architectural paths. **Path A is highly recommended** given the Discord Activity context.

### Path A: Discord-Native Socials (Recommended)
Since the app runs *inside* Discord, we treat a specific Discord Text Channel (e.g., `#creator-studio`) as our database.
*   **The Feed:** When a creator publishes a pose/avatar, the Activity uses the Discord API to post an embed message containing the image/video and metadata to the `#creator-studio` channel. The Activity's "Feed UI" simply fetches the latest messages from this channel.
*   **Upvotes:** Users upvote by clicking a button in the UI, which adds a specific Discord Reaction (e.g., :fire:) to the corresponding Discord message. The feed ranks posts by reaction count.
*   **Following:** We leverage Discord's native "Add Friend" or role systems, avoiding the need for a custom following graph.
*   **Tipping:** The feed displays the Creator's Solana address (hidden in the message metadata). When a user clicks "Tip" in the 3D app, Privy initiates an SPL token transfer directly on the Solana blockchain.
*   **Why this is best:** It is completely free, infinitely scalable, and drives engagement directly into the Discord server hosting the community.

### Path B: Solana-Native Socials (cNFTs)
If the feed must be global across *all* Discord servers, we use Solana State Compression.
*   **The Feed:** Every post is minted as a cheap Compressed NFT (cNFT) containing a link to the IPFS metadata (the pose/video). The Feed UI queries a Solana RPC (like Helius) for all cNFTs minted by our Studio Program.
*   **Upvotes/Follows:** Handled via on-chain state updates. This is technically robust but introduces friction, as every upvote or follow requires a blockchain transaction (even if subsidized).

## 4. Implementation Phasing

**Phase 1: Wallet & Tipping Infrastructure**
1. Initialize Privy with Discord Login.
2. Ensure the embedded Solana wallet is accessible.
3. Build the "Tip Creator" UI component that executes an SPL token transfer via `@solana/web3.js` using the Privy provider.

**Phase 2: The Studio Feed**
1. Implement the publishing flow (exporting WebGL canvas to an image/video).
2. Establish the "Database" strategy (Discord API vs. Solana cNFTs).
3. Build the scrolling Feed UI to display creators' work.

**Phase 3: Engagement & Rewards**
1. Implement Upvoting and Sharing mechanics.
2. Link the off-chain XP system with the on-chain Treasury distributions.