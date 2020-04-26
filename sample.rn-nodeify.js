const extend = require('xtend/mutable');
const coreList = require('rn-nodeify/coreList');
const browser = require('rn-nodeify/browser');
const shims = require('rn-nodeify/shims');

module.exports = {
  install: extend(coreList, {
    'sodium-native': true
  }),
  browser: extend(browser, {
    'sodium-native': 'sodium-javascript'
  }),
  shims: extend(shims, {
    'sodium-javascript': 'bcomnes/sodium-javascript#noise-support',
  }),
};
