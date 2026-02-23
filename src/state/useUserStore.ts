import { create } from 'zustand';

interface UserProfile {
  id: string;
  username: string | null;
  avatarUrl: string | null;
  credits: number;
}

interface UserState {
  user: UserProfile | null;
  isAuthenticated: boolean;
  
  setUser: (user: UserProfile | null) => void;
  updateCredits: (amount: number) => void;
  logout: () => void;
}

export const useUserStore = create<UserState>((set) => ({
  user: null,
  isAuthenticated: false,

  setUser: (user) => set({ user, isAuthenticated: !!user }),
  updateCredits: (amount) => set((state) => ({
    user: state.user ? { ...state.user, credits: amount } : null
  })),
  logout: () => set({ user: null, isAuthenticated: false }),
}));
