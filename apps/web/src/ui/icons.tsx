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
export const Compass = () => <I s={22}><circle cx="12" cy="12" r="9.5" /><path d="M12 5.5 15 12H9z" fill="#e5484d" stroke="#e5484d" /><path d="M12 18.5 9 12h6z" /></I>;
export const Directions = () => <I s={22}><circle cx="6" cy="19" r="2" /><circle cx="18" cy="5" r="2" /><path d="M8 19h6a3 3 0 0 0 0-6h-4a3 3 0 0 1 0-6h6" /></I>;
export const Walk = () => <I s={16} w={2}><circle cx="13" cy="4.5" r="1.6" /><path d="m9 21 2-6 2.5 2v4M10.5 9.5 8 12l-1 3M10.5 9.5l3-1.5 2.5 3 3 .5" /></I>;
export const Swap = () => <I s={18} w={2}><path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4" /></I>;
export const Pin = () => <I s={18} w={2}><path d="M12 21s-6.5-5.6-6.5-11a6.5 6.5 0 0 1 13 0C18.5 15.4 12 21 12 21z" /><circle cx="12" cy="10" r="2.3" /></I>;
