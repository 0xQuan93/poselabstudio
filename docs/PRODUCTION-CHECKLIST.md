# 🎯 PoseLab Production Pre-Launch Checklist

## 1. Authentication & Wallets
- [ ] **Discord Login:** Log out completely, then click the "Discord" button in the Privy modal. Verify that your Discord username and Profile Picture appear correctly in the top right.
- [ ] **Embedded Wallet Creation:** After logging in via Discord, open the Profile Modal. Verify that an embedded "Studio Wallet" address was automatically generated for you.
- [ ] **Phantom Connect:** Log out, then try logging in by clicking "Phantom" directly. Verify it connects smoothly without creating a second embedded wallet.

## 2. Rewards & Blockchain (Mainnet)
- [ ] **XP Persistence:** Browse around to earn some XP (Daily Logins, Exploration). Refresh the page. Ensure your XP does not reset to `0`.
- [ ] **Claiming $STUDIO:** Once you have at least `100 XP`, click the "Claim" button in the top bar. Open your Phantom wallet (or check Solscan for your embedded wallet address) and verify the `$STUDIO` tokens actually arrived.
- [ ] **Live Price Fetching:** Click the `$STUDIO` button in the top bar to open the wallet panel. Verify that it correctly fetches a live dollar value (or shows "Fetching..."/"Not Indexed" if the liquidity pool isn't public yet, without crashing).
- [ ] **Tipping:** Find a post in the Studio Feed that has a wallet linked. Click "Tip" and attempt to send a tiny fraction of `$STUDIO`. Ensure the transaction succeeds on Mainnet.

## 3. Discord Studio Feed Integration
- [ ] **Publishing:** Go to the Export tab and publish a pose. Check your actual Discord Server's Creator Studio channel. Ensure the bot posts the image, and that your Discord Name and Wallet Address appear in the embed (and that your raw Privy ID is *hidden*).
- [ ] **Upvoting:** Go to the Studio Feed inside the web app and click the 🔥 button on a pose. Verify that the number goes up, and check the Discord server to see if the bot physically added a 🔥 reaction to the corresponding message.

## 4. Gamification Mechanics
- [ ] **Daily Login (+50 XP):** Ensure the `Daily Login: +50 XP! 🔥` toast appears on your first login of the day.
- [ ] **Exploration Bonuses (+20 XP):** Click through the "Pose Lab", "Reactions", and "Studio" tabs. Verify you receive the one-time `Explorer Bonus` toast for each section.
- [ ] **Community Engagement (+10 XP):** Have another account upvote one of your published poses, then refresh your feed to ensure your XP balance increases accordingly.
