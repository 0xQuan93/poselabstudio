# 🤝 Contributing to PoseLab

Thank you for your interest in contributing to PoseLab! We are building the ultimate open-source tool for VRM content creation, and we need your help to make it happen.

Whether you're a developer, 3D artist, or UI designer, there's a place for you here.

---

## 🛠️ Development Setup

### Prerequisites
- **Node.js**: v18 or higher
- **Package Manager**: npm (v9+)
- **Git**

### Step-by-Step Guide

1.  **Fork the Repository**
    Click the "Fork" button on the top right of the GitHub page.

2.  **Clone Your Fork**
    ```bash
    git clone https://github.com/YOUR_USERNAME/project89-reaction-forge.git
    cd project89-reaction-forge
    ```

3.  **Install Dependencies**
    ```bash
    npm install
    ```

4.  **Set Up Environment Variables**
    Create a `.env` file in the root directory:
    ```env
    VITE_GEMINI_API_KEY=[REQUIRED]
    ```
    *(Note: You can run the app without an API key, but the AI Pose Generation feature will not work.)*

5.  **Start the Development Server**
    ```bash
    npm run dev
    ```
    Open `http://localhost:5173` in your browser.

---

## 📂 Project Structure

- **`src/components/`**: React UI components (Tabs, Overlays, Modals).
- **`src/three/`**: Core Three.js logic (`SceneManager`, `AvatarManager`, `Backgrounds`).
- **`src/poses/`**: Motion engine logic, IK solvers, and pose definitions.
- **`src/state/`**: Zustand stores for global app state (`useReactionStore`).
- **`public/`**: Static assets (icons, background SVGs, sample VRMs).

---

## 🧩 How to Contribute

### 1. 🐛 Reporting Bugs
Found a glitch? Please open an [Issue](https://github.com/0xQuan93/project89-reaction-forge/issues) with:
- A clear title.
- Steps to reproduce.
- Browser/Device details.
- Screenshots or console errors if possible.

### 2. ✨ Submitting Features
1.  Check the [ROADMAP.md](ROADMAP.md) to see what's planned.
2.  Open an Issue to discuss your idea *before* writing code (saves you time!).
3.  Create a branch: `git checkout -b feature/my-cool-feature`.
4.  Commit your changes: `git commit -m "Add cool feature"`.
5.  Push to your fork and submit a **Pull Request**.

### 3. 🎨 Visual & UX Improvements
We value polish. If you see a misaligned pixel, a confusing button, or a way to make an animation smoother, fix it!

---

## 📏 Coding Standards

- **TypeScript**: We use strict typing. Avoid `any` whenever possible.
- **Components**: Functional React components with Hooks.
- **Styling**: Pure CSS modules or standard CSS (we are migrating to a cleaner structure).
- **Three.js**: Keep 3D logic separate from UI logic where possible (use the Managers pattern).

---

## 📜 License

By contributing, you agree that your contributions will be licensed under the MIT License of this project.

---

**Thank you for building with us! 💚**
