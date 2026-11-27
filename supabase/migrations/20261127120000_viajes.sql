-- TransMi LIVE · avisos del viaje desde el servidor y posiciones compartidas (anónimas).
-- Lo aplica el dueño (ver supabase/LEEME-avisos.md). Solo la función `viajes` (con la llave de servicio, que Supabase le da sola) lee y
-- escribe estas tablas: RLS encendido y SIN políticas = nadie más (ni la llave pública de la app) puede leerlas ni escribirlas.

-- 1) Viajes activos de «Voy en este bus» con parada de bajada, para avisar aunque la app esté cerrada.
--    Los tokens de aviso identifican un teléfono: se borran al terminar el viaje y, como mucho, a las 3 h.
create table if not exists public.viajes_activos (
  id text primary key check (char_length(id) between 16 and 64),
  clave_hash text not null,                          -- sha-256 de la clave que solo conoce el teléfono (para cambiar o borrar su viaje)
  plataforma text not null check (plataforma in ('ios', 'android')),
  entorno text not null default 'produccion' check (entorno in ('produccion', 'pruebas')),   -- servidor de Apple (pruebas = compilación de Xcode)
  token_aviso text check (char_length(token_aviso) <= 512),
  token_actividad text check (char_length(token_actividad) <= 512),
  bus_id text not null check (char_length(bus_id) <= 64),
  parada_bajada text not null check (char_length(parada_bajada) <= 64),
  paradas_total int not null default 0 check (paradas_total between 0 and 500),
  ruta text not null default '' check (char_length(ruta) <= 40),
  color text not null default '#e11d2e' check (color ~ '^#[0-9a-fA-F]{6}$'),
  parada_nombre text not null default '' check (char_length(parada_nombre) <= 120),
  enviados jsonb not null default '{}'::jsonb,     -- avisos ya enviados o ya sonados en el teléfono ({"ride-1": 1764260000})
  ultimo_estado jsonb,                               -- lo último enviado a la actividad en vivo ({"left": 3, "eta": 1764260000})
  app_viva timestamptz,                              -- última vez que la app abierta dio señales (mientras está abierta, ella misma actualiza)
  sin_bus_desde timestamptz,                         -- desde cuándo el bus no aparece en los datos
  creado timestamptz not null default now(),
  actualizado timestamptz not null default now(),
  vence timestamptz not null default now() + interval '3 hours'
);
create index if not exists viajes_activos_vence on public.viajes_activos (vence);
alter table public.viajes_activos enable row level security;

-- 2) Posiciones compartidas por quien va en un bus con «Voy en este bus» y el GPS confirmando (solo con su permiso, en Más).
--    Sin persona ni teléfono: ruta, recorrido, metros del recorrido, hora, velocidad y, si es un bus de los datos, su número.
--    No se guarda la dirección IP ni la ubicación en coordenadas. Se borran a las 24 h.
create table if not exists public.posiciones_compartidas (
  id bigint generated always as identity primary key,
  ruta text not null check (char_length(ruta) between 1 and 40),
  recorrido smallint not null check (recorrido between 0 and 50),
  sentido smallint check (sentido in (0, 1)),
  metros real not null check (metros >= 0 and metros <= 300000),
  velocidad real check (velocidad >= 0 and velocidad <= 40),
  bus_id text check (char_length(bus_id) <= 64 and bus_id not like 'gps:%'),
  hora timestamptz not null,
  recibido timestamptz not null default now()
);
create index if not exists posiciones_compartidas_hora on public.posiciones_compartidas (hora);
alter table public.posiciones_compartidas enable row level security;

-- Borrado automático (además del que hace la función en cada vuelta). Necesita la extensión pg_cron (Database → Extensions).
-- Si pg_cron no está encendida, esta parte se salta sin error y el borrado queda solo a cargo de la función.
do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.schedule('viajes-vencidos', '*/10 * * * *', $q$delete from public.viajes_activos where vence < now()$q$);
    perform cron.schedule('posiciones-24h', '17 * * * *', $q$delete from public.posiciones_compartidas where hora < now() - interval '24 hours'$q$);
  end if;
end $$;

-- Almacenamiento público de solo lectura con las posiciones vigentes (vivo.json): las apps lo leen de ahí y no gastan invocaciones
-- de la función (cada 20 s por persona serían muchísimas). Solo la función escribe en él.
insert into storage.buckets (id, name, public) values ('compartidos', 'compartidos', true) on conflict (id) do nothing;
