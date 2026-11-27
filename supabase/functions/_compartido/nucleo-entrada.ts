// Lo que la función `viajes` usa del núcleo de la app. `tools/edge-core.ts` lo empaqueta en `nucleo.js` (un solo archivo que Deno lee
// sin las rutas sin extensión de `packages/*`). Así el servidor calcula las llegadas con el MISMO código que la app y la web.
export { TransitState, planRidePush, rideActivityChanged, dedupeSharedRides, RIDE_PUSH_MAX_MS, RIDE_PUSH_GONE_MS } from "../../../packages/application/src/index";
export { decodePositions } from "../../../packages/infrastructure/src/gtfsrt/decoders";
export { expandNetwork } from "../../../packages/infrastructure/src/gtfs/compact";
export { buildNetwork } from "../../../packages/infrastructure/src/gtfs/parse";
