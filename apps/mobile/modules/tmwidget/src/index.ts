import { requireOptionalNativeModule } from "expo";

/** Widget «Parada favorita» de Android. La app le deja la misma instantánea que al widget de iPhone (parada, próximos buses y horario). */
interface TmWidgetNative { setSnapshot(json: string): void }

/** El módulo nativo, o `null` donde no existe (iPhone, web, compilaciones viejas). */
export const TmWidget = requireOptionalNativeModule<TmWidgetNative>("TmWidget");
