module.exports = {
  "assert": true,
  "zlib": true,
  "buffer": true,
  "inherits": true,
  "console": true,
  "constants": true,
  "crypto": ['react-native-randombytes'],
  "dns": true,
  "domain": true,
  "events": true,
  "http": true,
  "https": true,
  "os": true,
  "path": true,
  "process": true,
  "punycode": true,
  "querystring": true,
  "fs": ["asyncstorage-down"],
  "dgram": true,
  "stream": [
    '_stream_transform',
    '_stream_readable',
    '_stream_writable',
    '_stream_duplex',
    '_stream_passthrough',
    'readable-stream'
  ],
  "string_decoder": true,
  "timers": true,
  "tty": true,
  "url": true,
  "util": true,
  "net": true,
  "vm": true,
  // note: tls doesn't have a shim
  "tls": true
}
