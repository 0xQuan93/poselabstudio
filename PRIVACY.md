# 🔒 Privacy & Data Sovereignty

**PoseLab** is designed with a "Local-First" architecture. We believe your digital avatar is an extension of your identity, and its data should remain under your control.

## 1. Local Processing
*   **Default local workflow:** VRM files loaded from your device, standard facial/body tracking, rendering, and local exports run in your browser. Raw camera and microphone streams are not sent to PoseLab servers during this workflow.
*   **Local storage:** Custom poses, application settings, the selected camera identifier, and Face AR calibration adjustments may be saved in browser storage. These records stay in that browser unless you export or share them. Raw camera frames, microphone audio, and local video recordings are not stored by the app in browser storage.
*   **Downloads:** Video and image recordings are created in the browser and saved through the browser's download flow. Your browser, operating system, or selected download location may retain them according to their own settings.

## 2. Camera, Microphone, and Facial XR
*   **Permission and processing:** Camera and microphone access require a browser permission prompt and are activated from the relevant control. MediaPipe-based facial and body tracking processes the live stream in the browser.
*   **Voice:** Voice lip sync analyzes microphone input locally. Voice chat is separate: enabling it publishes microphone audio to the LiveKit session for the people in that session.
*   **AI visual interpretation:** This optional feature can send one current webcam frame to Google Gemini to interpret pose or expression. PoseLab displays a fresh confirmation before each frame is captured or transmitted; choosing Cancel keeps the frame on-device. Google's processing is governed by Google's applicable terms and privacy policies.

## 3. AI Features (Gemini)
*   **Optional:** The AI Pose Generation feature is optional.
*   **Data Transmission:** Text prompts, AI-chat messages, and the chat context needed to answer them are sent to Google's Gemini API or the configured server-side Gemini proxy. The optional visual interpretation flow is described above.
*   **No Avatar Data:** Your VRM model, its blendshapes, and its mesh data are **never** sent to the AI. The AI returns generic pose data (bone rotations) which is then applied locally to your avatar.

## 4. Multiplayer, Community, and Third-Party Delivery
*   **Multiplayer:** Joining a LiveKit room shares the display name, avatar pose/expression updates, and, when an avatar is loaded, the VRM file with room participants so their clients can render it. Do not join or share an avatar unless you have the rights and consent to do so. Voice is only published after you enable voice chat.
*   **Community publishing:** Publishing to the Studio Feed sends the selected image, supplied description, creator display name/avatar, and any supplied wallet address to Discord. Those posts are visible and retained according to the Discord server's settings and Discord's policies.
*   **Account connection:** Discord login requests the scopes shown on Discord's authorization screen and uses the returned profile and role information for the signed-in experience.
*   **Delivery providers:** The app loads optional runtime assets from providers such as Google Fonts, jsDelivr, Live2D, GitHub, Google, Discord, and LiveKit. Those providers can receive routine network metadata such as your IP address and request headers under their own policies.

## 5. Your IP and Provenance
*   **Your avatar and assets:** You are responsible for confirming that you have the rights, required attribution, and any required permissions to use, record with, share, or publish each avatar, background, music track, and other uploaded asset.
*   **Your poses:** The animations and poses you create are yours to the extent allowed by the licenses and rights attached to the original avatar and assets you used.
*   **Take Passport:** After a local video recording, PoseLab can create a separate, local-only Take Passport for you to download. It records the take's hash, MIME type, canvas size, non-identifying track settings, avatar label, and capture events so you can verify the exported file later. It does not contain raw camera frames, voice audio, device identifiers, or an upload destination.

## 6. Community & Trust
As part of the **Iris Network** initiative, we are committed to transparency. This tool is a "resistance asset" meant to empower creators, not extract data from them.

*Last Updated: 2026-07-18*

