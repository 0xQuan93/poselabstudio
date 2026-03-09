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
  updateLp: (amount: number, reason?: string) => void;
  deductLp: (amount: number, reason?: string) => void;
  
  // Gamification
  recordDailyLogin: () => Promise<number>; // Returns LP granted (0 if already claimed)
  recordExploration: (milestoneId: string, lpReward?: number) => number; // Returns LP granted
  
  // Sync wrapper
  addLpToBot: (amount: number, discordId: string, reason?: string) => Promise<void>;
  fetchLpFromBot: (discordId: string) => Promise<void>;
  
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

      addLpToBot: async (amount: number, discordId: string, reason?: string) => {
        try {
          const response = await fetch('/.netlify/functions/bot-lp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'add',
              discordUserId: discordId,
              lpAmount: amount,
              reason: reason
            })
          });
          if (response.ok) {
            const data = await response.json();
            // Source of Truth: Set the user's LP to the newly calculated total from the Discord Ledger
            if (data.success && typeof data.lp === 'number') {
              const state = get();
              if (state.user) {
                set({ user: { ...state.user, lp: data.lp } });
              }
            }
          }
        } catch (e) {
          console.error("Failed to add LP to Discord Bot", e);
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
      
      updateLp: (amount, reason) => {
        const state = get();
        if (!state.user) return;
        
        // Optimistic UI update
        const newLp = state.user.lp + amount;
        set({ user: { ...state.user, lp: newLp } });
        
        if (state.user.discordId) {
           state.addLpToBot(amount, state.user.discordId, reason || 'update_lp');
        }
      },
      
      deductLp: (amount, reason) => {
        const state = get();
        if (!state.user) return;
        
        // Optimistic UI update
        const newLp = Math.max(0, state.user.lp - amount);
        set({ user: { ...state.user, lp: newLp } });
        
        if (state.user.discordId) {
           state.addLpToBot(-amount, state.user.discordId, reason || 'deduct_lp');
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
             // Synchronize LP even on cooldown
             if (typeof data.lp === 'number') {
               set({ user: { ...state.user, lp: data.lp } });
             }
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
        
        // Optimistic update
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
           state.addLpToBot(lpReward, state.user.discordId, milestoneId);
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
