Pod::Spec.new do |s|
  s.name           = 'TripActivity'
  s.version        = '1.0.0'
  s.summary        = 'Viaje en curso en la pantalla de bloqueo y la isla dinámica'
  s.description    = 'Muestra y actualiza la actividad en vivo del viaje que la persona sigue en TransMi LIVE.'
  s.license        = 'MIT'
  s.author         = 'TransMi LIVE'
  s.homepage       = 'https://transmilive.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/itsandresortiz/transmi-live' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
end
