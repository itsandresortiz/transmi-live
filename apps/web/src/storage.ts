/** localStorage que nunca rompe la app (modo privado, almacenamiento lleno o bloqueado). */
export const safeStorage = {
  get(key: string): string | null { try { return localStorage.getItem(key); } catch { return null; } },
  set(key: string, value: string): void { try { localStorage.setItem(key, value); } catch { /* sin espacio o bloqueado */ } },
  remove(key: string): void { try { localStorage.removeItem(key); } catch { /* nada */ } },
};
