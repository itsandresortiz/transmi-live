/** Texto que cambia con efecto de rodillo: solo las letras que cambian (casi siempre los segundos; los minutos cuando les toca)
 *  entran desde abajo; las demás quedan quietas. Si el texto cambia de largo, cambia de una vez. Con «reducir movimiento» no se anima (CSS). */
export function Rolling({ text }: { text: string }) {
  const chars = [...text];
  return (
    <span className="roll" aria-label={text} role="text">
      {/* la clave incluye la letra: si cambia, React crea una nueva y la animación de entrada vuelve a correr */}
      {chars.map((ch, i) => <span key={`${chars.length}-${i}-${ch}`} className="rc" aria-hidden="true">{ch === " " ? " " : ch}</span>)}
    </span>
  );
}
