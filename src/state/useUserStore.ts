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
  
  // Gamification
  recordGamifiedAction: (actionName: string) => Promise<number>; // Returns LP granted
  recordDailyLogin: () => Promise<number>; 
  recordExploration: (milestoneId: string) => Promise<number>; 
  
  // Sync wrapper
  fetchLpFromBot: (discordId: string) => Promise<void>;
  
  logout: () => void;
}

export const useUserStore = create<UserState>()(
  persist(
    (set, get) => ({
      user: null,
      isAuthenticated: false,

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
      
      recordGamifiedAction: async (actionName: string) => {
        const state = get();
        if (!state.user || !state.user.discordId) return 0;

        try {
          const response = await fetch('/.netlify/functions/bot-lp', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              action: 'grant_action',
              actionName,
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
             console.log(`${actionName} already claimed. Cooldown active.`);
             return 0;
          }
        } catch (e) {
           console.error(`Failed to claim gamified action: ${actionName}`, e);
        }
        return 0;
      },
      
      recordDailyLogin: async () => {
         return await get().recordGamifiedAction('daily_login');
      },
      
      recordExploration: async (milestoneId: string) => {
        const state = get();
        if (!state.user) return 0;
        
        const milestones = state.user.explorationMilestones || {};
        if (milestones[milestoneId]) {
          return 0; // Local check to save a request
        }
        
        // Optimistic local cache update so we don't spam requests
        set({
          user: {
            ...state.user,
            explorationMilestones: {
              ...milestones,
              [milestoneId]: true
            }
          }
        });

        // Use the general visit_tabs or explore_app action
        const actionName = milestoneId.includes('tab') ? 'visit_tabs' : 'explore_app';
        return await get().recordGamifiedAction(actionName);
      },

      logout: () => set({ user: null, isAuthenticated: false }),
    }),
    {
      name: 'user-storage',
      partialize: (state) => ({ user: state.user }), // Only persist the user object
    }
  )
);
