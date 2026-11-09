import { MotionEngine } from "@transmi/application";
import { transit } from "@/composition-root";

/** El mismo motor de movimiento de la web: coloca cada bus sobre su ruta y lo hace avanzar entre un reporte y otro. */
export const motion = new MotionEngine(transit);
