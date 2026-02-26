# Architecture Plan: Studio & Creator Rewards

## 1. Core Philosophy
The "Studio" is designed exclusively to empower the Creator Rewards program. It operates entirely without a traditional database or Node.js backend. Instead, it leverages:
- **Discord API:** For identity, distribution, and acting as the "database" for social interactions.
- **Netlify Functions:** To provide secure, serverless logic for publishing, upvoting, and syncing points.

## 2. Gamification & Lab Points (LP)
- **Lab Points (LP):** Users earn LP through app engagement (Daily Login, Exploring features, Publishing Poses).
- **The Discord Bot:** A backend bot (interfaced via serverless functions) maintains a persistent ledger of each user's total LP, ensuring it persists across sessions and servers.
- **Engagement Loop:** Publishing a pose rewards the creator with LP. Community upvotes (via Discord reactions) further boost the creator's standing and rewards.

## 3. Social Mechanics (The Backend-less Strategy)

To achieve a Feed, Upvoting, and Following without a traditional database, we leverage Discord's native infrastructure:

### Discord-Native Socials
Since the app runs *inside* Discord, we treat a specific Discord Text Channel (e.g., `#creator-studio`) as our database.
*   **The Feed:** When a creator publishes a pose, the app uses the Discord API to post an embed message containing the image and metadata to the `#creator-studio` channel. The app's "Studio Feed" UI simply fetches the latest 50 messages from this channel.
*   **Upvotes:** Users upvote by clicking a button in the UI, which adds a specific Discord Reaction (e.g., 🔥) to the corresponding message. The feed parses these reactions to display upvote counts.
*   **LP Aggregation:** When a user logs in, the app scans the Discord history to calculate total upvotes received and syncs their LP balance accordingly.
*   **Why this is best:** It is free, scalable, and drives engagement directly into the Discord community.

## 4. Implementation Phasing

**Phase 1: Identity & Ecosystem Infrastructure**
1. Implement Discord OAuth2 login.
2. Build the centralized Lab Points (LP) system.
3. Establish session persistence with secure cookies.

**Phase 2: The Studio Feed**
1. Implement the publishing flow (exporting WebGL canvas to an image).
2. Build the `publish-pose.ts` bridge to post rich embeds to Discord.
3. Build the scrolling `CreatorFeed.tsx` to display creators' work from the channel history.

**Phase 3: Engagement & Rewards**
1. Implement the `upvote-pose.ts` system using Discord reactions.
2. Link the engagement system with the LP rewards engine.
3. Develop the Profile UI to display accumulated rewards and milestones.