# Technical Breakdown: PoseLab

> **Audit Report:** For a detailed analysis of system limitations, architectural risks, and performance bottlenecks, please see [TECHNICAL-AUDIT.md](./docs/TECHNICAL-AUDIT.md).

This document provides a technical overview of the Reaction Forge application, including its architecture, dependencies, and key features.

## Project Overview

PoseLab (formerly Reaction Forge) is a web-based tool for creating and exporting VRM avatar reactions, including cinematic sequences with Director Mode. It is built with React, Three.js, and Vite, and uses Zustand for state management. The application has two main modes:

*   **Reaction Forge**: The main interface for loading VRM avatars, applying poses and animations, and exporting the results as PNG images or WebM videos.
*   **Pose Lab**: A tool for converting Mixamo FBX animations to a format compatible with Reaction Forge.

## VRM Specs & PoseLab Practices

For VRM specification details (humanoid bones, MToon, 0.0 vs 1.0) and recommended practices for PoseLab (avatar prep, Mixamo/FBX retargeting, mocap, expressions, export), see **[VRM Specs & PoseLab Best Practices](./docs/VRM-SPECS-AND-POSELAB-BEST-PRACTICES.md)**.

## Technology Stack

*   **Frontend Framework**: React 19
*   **3D Rendering**: Three.js
*   **VRM Support**: `@pixiv/three-vrm` and `@pixiv/three-vrm-animation`
*   **Live2D Support**: `pixi.js` + `pixi-live2d-display`
*   **State Management**: Zustand
*   **Build Tool**: Vite
*   **Language**: TypeScript
*   **Styling**: CSS Modules
*   **Networking**: LiveKit (WebRTC SFU) + Netlify Functions (Token generation)
*   **AI**: Google Gemini API

## Project Structure

The project is organized into the following directories:

*   **`src`**: The main source code for the application.
    *   **`components`**: React components, organized by feature.
    *   **`pose-lab`**: Logic for the Pose Lab tool.
    *   **`poses`**: JSON definitions for poses and animations, and the `motionEngine.ts` for procedural animations.
    *   **`state`**: Zustand stores for managing application state.
    *   **`three`**: Core Three.js logic, separated into managers for animations, avatars, backgrounds, and the main scene.
    *   **`utils`**: Utility functions.
    *   **`App.tsx`**: The main React component.
*   **`public`**: Static assets, such as sample VRM files and backgrounds.
*   **`docs`**: Project documentation.
*   **`scripts`**: Scripts for analysis and generation.

## Key Features

### Motion Engine

The Motion Engine is a procedural animation synthesis system that generates natural-looking animations on the fly. It uses a set of bio-mechanical constraints and kinetic lag to simulate realistic body mechanics.

### Reaction Forge

The Reaction Forge is the main interface for creating and exporting VRM avatar reactions. It allows users to:

*   Load custom VRM avatars.
*   Apply pre-made reaction presets.
*   Use custom poses and animations.
*   Control expressions.
*   Choose from a variety of themed backgrounds.
*   Export reactions as PNG images or WebM animations.

### Pose Lab

The Pose Lab is a dedicated environment for advanced animation management. It allows users to:

*   **Batch Retarget**: Automatically convert a library of Mixamo FBX files to the current VRM avatar's skeleton.
*   **Preview**: Play back animations on the loaded avatar.
*   **Export**: Save pose definitions and animation clips as JSON.

### Director Mode

Director Mode enables the creation of cinematic camera sequences and animated camera paths. Key aspects include:

*   **AI Script Generation**: Integration with Google Gemini API to generate camera scripts from natural language prompts.
*   **Timeline Integration**: Scripts are represented as a series of camera shots on a timeline, allowing for precise control over camera movements, duration, and transitions.
*   **State Persistence**: Director scripts are part of the project state and are saved/loaded with the project.

## State Management

The application uses Zustand for state management. Key stores include:

*   **`useAvatarSource`**: Manages the currently loaded VRM avatar.
*   **`useReactionStore`**: Manages the state of the Reaction Forge, including the current pose, animation, expression, and background.
*   **`useDirectorStore`**: Manages the state and timeline for Director Mode camera scripts.
*   **Project Persistence**: The `projectManager.ts` and `autosaveManager.ts` handle saving and loading the full application state, including Director Mode scripts, poses, and other settings.

## 3D Rendering

The 3D rendering is handled by Three.js. The core logic is separated into a set of managers in the `src/three` directory:

*   **`animationManager.ts`**: Manages animations.
*   **`avatarManager.ts`**: Manages VRM avatars.
*   **`backgrounds.ts`**: Manages standard 2D/video backgrounds.
*   **`environmentManager.ts`**: Manages HDRI environments and lighting.
*   **`sceneManager.ts`**: Manages the main Three.js scene.
