import type { ProjectState } from '../types/project';

export interface AutosaveEntry {
  id: string;
  name: string;
  createdAt: number;
  project: ProjectState;
}

const STORAGE_KEY = 'poselab-autosaves';

const safeParse = (value: string | null): AutosaveEntry[] => {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as AutosaveEntry[];
    if (!Array.isArray(parsed)) return [];
    return parsed;
  } catch {
    return [];
  }
};

export const autosaveManager = {
  getAutosaves(): AutosaveEntry[] {
    return safeParse(window.localStorage.getItem(STORAGE_KEY));
  },

  addAutosave(project: ProjectState, maxEntries: number): AutosaveEntry {
    const fallbackId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : fallbackId;
    const entry: AutosaveEntry = {
      id,
      name: project.metadata.name || 'Autosave',
      createdAt: Date.now(),
      project,
    };
    const existing = autosaveManager.getAutosaves();
    const next = [entry, ...existing].slice(0, Math.max(1, maxEntries));
    
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch (e: any) {
      // If quota is exceeded (e.g. from previous heavy autosaves), clear all and retry with just the latest
      if (e.name === 'QuotaExceededError' || e.message.includes('quota')) {
        console.warn('LocalStorage quota exceeded. Clearing old autosaves to free space...');
        try {
          window.localStorage.removeItem(STORAGE_KEY);
          window.localStorage.setItem(STORAGE_KEY, JSON.stringify([entry]));
        } catch (retryError) {
          console.error('Failed to save autosave even after clearing space:', retryError);
        }
      } else {
        console.error('Failed to save autosave:', e);
      }
    }
    return entry;
  },

  removeAutosave(id: string) {
    const existing = autosaveManager.getAutosaves();
    const next = existing.filter((entry) => entry.id !== id);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  },

  clearAutosaves() {
    window.localStorage.removeItem(STORAGE_KEY);
  },
};
