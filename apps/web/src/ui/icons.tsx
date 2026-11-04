import type { ReactNode } from "react";
const base = { fill: "none", stroke: "currentColor", strokeLinecap: "round", strokeLinejoin: "round" } as const;
const I = ({ s = 20, w = 1.8, children, className = "ic" }: { s?: number; w?: number; children: ReactNode; className?: string }) =>
  <svg className={className} width={s} height={s} viewBox="0 0 24 24" strokeWidth={w} {...base} aria-hidden="true">{children}</svg>;
export const Locate = () => <I s={22}><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="7.5" /><path d="M12 2.5V6M12 18v3.5M2.5 12H6M18 12h3.5" /></I>;
export const Sliders = () => <I s={22}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></I>;
export const Search = () => <I s={19} w={2}><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></I>;
export const Close = () => <I s={16} w={2.4}><path d="M6 6l12 12M18 6 6 18" /></I>;
export const Chevron = () => <I s={18} w={2.2}><path d="m9 6 6 6-6 6" /></I>;
export const Back = () => <I s={18} w={2.4}><path d="m15 6-6 6 6 6" /></I>;
export const Bus = () => <I s={30} w={1.6}><rect x="4" y="3" width="16" height="14" rx="3" /><path d="M4 11h16M8 21l1.5-4M16 21l-1.5-4" /><circle cx="8" cy="14" r=".7" /><circle cx="16" cy="14" r=".7" /></I>;
export const Mark = () => <svg viewBox="0 0 24 24" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="4" y="3" width="16" height="14" rx="3" /><path d="M4 11h16M8 21l1.5-4M16 21l-1.5-4" /><circle cx="8" cy="14" r=".7" /><circle cx="16" cy="14" r=".7" /></svg>;
