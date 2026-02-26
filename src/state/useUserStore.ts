import { create } from 'zustand';
import { persist } from 'zustand/middleware';

interface UserProfile {
  id: string; // Discord ID
  discordId?: string | null; // Extracted Discord Snowflake
  username: string | null;
  avatarUrl: string | null;
  roles?: string[]; // Discord Role IDs
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
  recordDailyLogin: () => Promise<number>; // Returns LP granted (0 if already claimed)
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
      
      recordDailyLogin: async () => {
        const state = get();
        if (!state.user || !state.user.discordId) return 0;

        try {
          const response = await fetch('/.netlify/functions/bot-lp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'daily_login',
              discordUserId: state.user.discordId
            })
          });

          if (!response.ok) return 0;
          
          const data = await response.json();
          if (data.success && data.reward > 0) {
             set({ user: { ...state.user, lp: data.lp } });
             return data.reward;
          } else if (data.reason === 'cooldown') {
             // Optional: You could update state to show a toast via a return value
             console.log('Daily login already claimed. Next claim in:', data.timeLeft);
             return 0;
          }
        } catch (e) {
           console.error("Failed to claim daily login", e);
        }
        return 0;
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
