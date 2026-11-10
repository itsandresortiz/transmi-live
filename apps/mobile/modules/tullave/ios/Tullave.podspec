Pod::Spec.new do |s|
  s.name           = 'Tullave'
  s.version        = '1.0.0'
  s.summary        = 'Lectura del saldo de la tarjeta TuLlave por NFC'
  s.description    = 'Lee la tarjeta TuLlave en el teléfono con Core NFC y devuelve las respuestas de la tarjeta sin interpretar.'
  s.license        = 'MIT'
  s.author         = 'TransMi LIVE'
  s.homepage       = 'https://transmilive.com'
  s.platforms      = { :ios => '16.4' }
  s.source         = { git: 'https://github.com/itsandresortiz/transmi-live' }
  s.static_framework = true
  s.dependency 'ExpoModulesCore'
  s.source_files = "**/*.{h,m,swift}"
end
