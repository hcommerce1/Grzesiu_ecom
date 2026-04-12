import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FieldSelection } from '../types';

interface FieldPreferencesState {
  preferences: Partial<FieldSelection>;
  setPreferences: (prefs: Partial<FieldSelection>) => void;
  mergePreferences: (patch: Partial<FieldSelection>) => void;
}

export const useFieldPreferences = create<FieldPreferencesState>()(
  persist(
    (set) => ({
      preferences: {},
      setPreferences: (prefs) => set({ preferences: prefs }),
      mergePreferences: (patch) =>
        set((state) => ({
          preferences: { ...state.preferences, ...patch },
        })),
    }),
    {
      name: 'bl-field-preferences',
    }
  )
);
