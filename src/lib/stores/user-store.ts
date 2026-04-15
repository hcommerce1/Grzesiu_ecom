import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { AppUser } from '@/lib/user';

interface UserStore {
  user: AppUser | null;
  fetchUser: () => Promise<void>;
}

export const useUserStore = create<UserStore>()(
  persist(
    (set) => ({
      user: null,
      fetchUser: async () => {
        try {
          const res = await fetch('/api/user');
          if (res.ok) {
            const data = await res.json();
            set({ user: data.user });
          }
        } catch {
          // ignore
        }
      },
    }),
    {
      name: 'user-store',
      partialize: (state) => ({ user: state.user }),
    }
  )
);
