// ---------------------------------------------------------------------------
// UI store — sidebar & dark-mode state
// ---------------------------------------------------------------------------

import { create } from "zustand";

export interface UIState {
  sidebarCollapsed: boolean;
  darkMode: boolean;
  toggleSidebar: () => void;
  toggleDarkMode: () => void;
  setDarkMode: (dark: boolean) => void;
}

export const useUIStore = create<UIState>((set) => ({
  sidebarCollapsed: false,
  darkMode: false,

  toggleSidebar: () =>
    set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),

  toggleDarkMode: () =>
    set((state) => ({ darkMode: !state.darkMode })),

  setDarkMode: (dark) => set({ darkMode: dark }),
}));
