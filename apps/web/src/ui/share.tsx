import { shareUrl, type Target } from "../deeplink";
import { useUi } from "./store";

/** Comparte el enlace con la hoja nativa del celular (WhatsApp, etc.) o, si no existe, lo copia. */
export function ShareButton({ target, title }: { target: Target; title: string }) {
  const go = async () => {
    const url = shareUrl(target);
    try {
      if (navigator.share) { await navigator.share({ title, text: `${title} en TransMi LIVE`, url }); return; }
    } catch (e) { if ((e as Error).name === "AbortError") return; }
    try { await navigator.clipboard.writeText(url); useUi.getState().showToast("Enlace copiado"); }
    catch { useUi.getState().showToast("No pudimos copiar el enlace"); }
  };
  return (
    <button className="star" aria-label={`Compartir ${title}`} onClick={() => void go()}>
      <svg width="20" height="20" viewBox="0 0 24 24" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M12 15V3M8 7l4-4 4 4M5 12v7a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-7" /></svg>
    </button>
  );
}
