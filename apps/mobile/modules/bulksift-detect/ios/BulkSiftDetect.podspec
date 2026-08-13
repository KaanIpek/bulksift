Pod::Spec.new do |s|
  s.name           = 'BulkSiftDetect'
  s.version        = '1.0.0'
  s.summary        = 'The per-pixel half of card detection, in C++.'
  s.description    = 'Work grid, Sobel, threshold and connected components. ' \
                     'Ported from the TypeScript and checked against it frame by frame.'
  s.author         = ''
  s.homepage       = 'https://github.com/KaanIpek/bulksift'
  s.platforms      = { :ios => '15.1' }
  s.source         = { git: '' }
  s.static_framework = true

  s.dependency 'ExpoModulesCore'

  s.pod_target_xcconfig = {
    'DEFINES_MODULE' => 'YES',
    'CLANG_CXX_LANGUAGE_STANDARD' => 'c++17',
    'SWIFT_COMPILATION_MODE' => 'wholemodule'
  }

  s.source_files = '**/*.{h,m,mm,swift,hpp,cpp}'
end
