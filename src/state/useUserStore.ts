import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserProfile {
  id: string; // Discord ID
  discordId?: string | null; // Extracted Discord Snowflake
  username: string | null;
  avatarUrl: string | null;
  lp: number; // Local fallback/cache for Lab Points
  lastLoginDate?: string | null;
  explorationMilestones?: Record<string, boolean>;
}

interface UserState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  
  setUser: (user: UserProfile | null) => void;
  updateLp: (amount: number) => void;
  deductLp: (amount: number) => void;
  
  // Gamification
  recordDailyLogin: () => number; // Returns LP granted (0 if already claimed)
  recordExploration: (milestoneId: string, lpReward?: number) => number; // Returns LP granted
  
  // Sync wrapper
  syncLpToBot: (newTotalLp: number, discordId: string) => Promise<void>;
  fetchLpFromBot: (discordId: string) => Promise<void>;
  
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      syncLpToBot: async (newTotalLp: number, discordId: string) => {
        try {
          await fetch('/.netlify/functions/bot-lp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'write',
              discordUserId: discordId,
              lpAmount: newTotalLp
            })
          });
        } catch (e) {
          console.error("Failed to sync LP to Discord Bot", e);
        }
      },

      fetchLpFromBot: async (discordId: string) => {
        try {
          const response = await fetch('/.netlify/functions/bot-lp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'read',
              discordUserId: discordId
            })
          });
          if (response.ok) {
            const data = await response.json();
            if (typeof data.lp === 'number') {
              const state = get();
              if (state.user) {
                set({ user: { ...state.user, lp: data.lp } });
              }
            }
          }
        } catch (e) {
          console.error("Failed to fetch LP from Discord Bot", e);
        }
      },

      setUser: (user) => set({ user, isAuthenticated: !!user }),
      
      updateLp: (amount) => {
        const state = get();
        if (!state.user) return;
        const newLp = state.user.lp + amount;
        
        set({ user: { ...state.user, lp: newLp } });
        
        if (state.user.discordId) {
           state.syncLpToBot(newLp, state.user.discordId);
        }
      },
      
      deductLp: (amount) => {
        const state = get();
        if (!state.user) return;
        const newLp = Math.max(0, state.user.lp - amount);
        
        set({ user: { ...state.user, lp: newLp } });
        
        if (state.user.discordId) {
           state.syncLpToBot(newLp, state.user.discordId);
        }
      },
      
      recordDailyLogin: () => {
        const state = get();
        if (!state.user) return 0;
        
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        if (state.user.lastLoginDate === today) {
          return 0; // Already claimed today
        }
        
        const reward = 50; // 50 LP for daily login
        const newLp = state.user.lp + reward;
        
        set({
          user: {
            ...state.user,
            lp: newLp,
            lastLoginDate: today
          }
        });
        
        if (state.user.discordId) {
           state.syncLpToBot(newLp, state.user.discordId);
        }
        return reward;
      },
      
      recordExploration: (milestoneId: string, lpReward = 10) => {
        const state = get();
        if (!state.user) return 0;
        
        const milestones = state.user.explorationMilestones || {};
        if (milestones[milestoneId]) {
          return 0; // Already explored this feature
        }
        
        const newLp = state.user.lp + lpReward;
        
        set({
          user: {
            ...state.user,
            lp: newLp,
            explorationMilestones: {
              ...milestones,
              [milestoneId]: true
            }
          }
        });
        
        if (state.user.discordId) {
           state.syncLpToBot(newLp, state.user.discordId);
        }
        return lpReward;
      },

      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({ user: state.user }), // Only persist the user object
    }
  )
);
