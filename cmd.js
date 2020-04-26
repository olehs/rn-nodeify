#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const semver = require('semver')
const proc = require('child_process')
// const pick = require('object.pick')
const extend = require('xtend/mutable')
const deepEqual = require('deep-equal')
const find = require('findit')
const minimist = require('minimist')
const parallel = require('run-parallel')
const yarnlock = require('@yarnpkg/lockfile')
const pkgPath = path.join(process.cwd(), 'package.json')
const pkg = require(pkgPath)
const hackFiles = require('./pkg-hacks')
const argv = minimist(process.argv.slice(2), {
  alias: {
    h: 'help',
    i: 'install',
    e: 'hack',
    o: 'overwrite',
    y: 'yarn'
  }
})
var coreList = require('./coreList')
var allShims = require('./shims')
var browser = require('./browser')

const BASE_INSTALL_LINE = argv.yarn ? 'yarn add' : 'npm install --save'

if (argv.help) {
  runHelp()
  process.exit(0)
} else {
  run()
}

function run () {
  const cfgPath = path.join(process.cwd(), '.rn-nodeify.js')
  const cfg = fs.existsSync(cfgPath) && require(cfgPath);

  let toShim
  if(cfg) {
    if (cfg.install) {
      coreList = cfg.install
    }
    if (cfg.shims) {
      allShims = cfg.shims
    }
    if (cfg.browser) {
      browser = cfg.browser
    }
  }

  if (argv.install) {
    if (argv.install === true) {
      toShim = coreList
    } else {
      toShim = argv.install.split(',')
        .map(function (name) {
          return name.trim()
        })
    }
  } else {
    toShim = coreList
  }

  for (const name in toShim) {
    if (Array.isArray(toShim[name])) {
      toShim[name].forEach(function (m) {
        toShim[m] = true
      })
    }
  }
  const moduleNames = Object.keys(toShim)
  .filter(function (m) {
    return toShim[m]
  })

  if (argv.install) {
    installShims({
      modules: moduleNames,
      overwrite: argv.overwrite
    }, function (err) {
      if (err) throw err

      runHacks(moduleNames)
    })
  } else {
    runHacks(moduleNames)
  }

  function runHacks (modules) {
    hackPackageJSONs(modules, function (err) {
      if (err) throw err

      if (argv.hack) {
        if (argv.hack === true) hackFiles()
        else hackFiles([].concat(argv.hack))
      }
    })
  }
}

function installShims ({ modules, overwrite }, done) {
  if (!overwrite) {
    modules = modules.filter(name => {
      const shimPackageName = browser[name] || name
      if (pkg.dependencies[shimPackageName]) {
        log(`not overwriting "${shimPackageName}"`)
        return false
      }

      return true
    })
  }

  const shimPkgNames = modules
    .map(function (m) {
      return browser[m] || m
    })
    .filter(function (shim) {
      return !(/^_/).test(shim) && (shim[0] === '@' || shim.indexOf('/') === -1)
    })

  if (!shimPkgNames.length) {
    return finish()
  }

  // Load the exact package versions from the lockfile
  let lockfile
  if (argv.yarn) {
    if (fs.existsSync('yarn.lock')) {
      const result = yarnlock.parse(fs.readFileSync('yarn.lock', 'utf8'))
      if (result.type == 'success') {
        lockfile = result.object
      }
    }
  } else {
    const lockpath = path.join(process.cwd(), 'package-lock.json')
    if (fs.existsSync(lockpath)) {
      const result = require(lockpath)
      if (result && result.dependencies) {
        lockfile = result.dependencies
      }
    }
  }

  parallel(shimPkgNames.map(function (name) {
    const modPath = path.resolve('./node_modules/' + name)
    return function (cb) {
      fs.exists(modPath, function (exists) {
        if (!exists) return cb()

        let install = true
        if (lockfile) {
          // Use the lockfile to resolve installed version of package
          if (argv.yarn) {
            if (`${name}@${allShims[name]}` in lockfile) {
              install = false
            }
          } else {
            let lockfileVer = (lockfile[name] || {}).version
            const targetVer = allShims[name]
            if (semver.valid(lockfileVer)) {
              if (semver.satisfies(lockfileVer, targetVer)) {
                install = false
              }
            } else if (lockfileVer) {
              // To be considered up-to-date, we need an exact match,
              // after doing some normalization of github url's
              if (lockfileVer.startsWith('github:')) {
                lockfileVer = lockfileVer.slice(7)
              }
              if (lockfileVer.indexOf(targetVer) == 0) {
                install = false
              }
            }
          }
        } else {
          // Fallback to using the version from the dependency's package.json
          const pkgJson = require(modPath + '/package.json')
          if ((/^git:\/\//).test(pkgJson._resolved)) {
            const hash = allShims[name].split('#')[1]
            if (hash && pkgJson.gitHead.indexOf(hash) === 0) {
              install = false
            }
          } else {
            const existingVerNpm5 = ((/-([^-]+)\.tgz/).exec(pkgJson.version) || [null, null])[1]
            const existingVer = existingVerNpm5 || pkgJson.version
            if (semver.satisfies(existingVer, allShims[name])) {
              install = false
            }
          }
        }

        if (!install) {
          log('not reinstalling ' + name)
          shimPkgNames.splice(shimPkgNames.indexOf(name), 1)
        }

        cb()
      })
    }
  }), function (err) {
    if (err) throw err

    if (!shimPkgNames.length) {
      return finish()
    }

    let installLine = BASE_INSTALL_LINE + ' '
    shimPkgNames.forEach(function (name) {
      const version = allShims[name]
      if (!version) return
      if (version.indexOf('/') === -1) {
        if (argv.yarn) {
          log('installing from yarn', name)
        } else {
          log('installing from npm', name)
        }
        installLine += name + '@' + version
      } else {
        // github url
        log('installing from github', name)
        installLine += version.match(/([^/]+\/[^/]+)$/)[1]
      }

      pkg.dependencies[name] = version
      installLine += ' '
    })

    fs.writeFile(pkgPath, prettify(pkg), function (err) {
      if (err) throw err

      if (installLine.trim() === BASE_INSTALL_LINE) {
        return finish()
      }

      log('installing:', installLine)
      proc.execSync(installLine, {
        cwd: process.cwd(),
        env: process.env,
        stdio: 'inherit'
      })

      finish()
    })
  })

  function finish () {
    copyShim(done)
  }
}

function copyShim (cb) {
  fs.exists('./shim.js', function (exists) {
    if (exists) {
      log('not overwriting shim.js. For the latest version, see rn-nodeify/shim.js')
      return cb()
    }

    fs.readFile(path.join(__dirname, 'shim.js'), { encoding: 'utf8' }, function (err, contents) {
      if (err) return cb(err)

      fs.writeFile('./shim.js', contents, cb)
    })
  })
}

function hackPackageJSONs (modules, done) {
  fixPackageJSON(modules, './package.json', true)

  const finder = find('./node_modules')

  finder.on('file', function (file) {
    if (path.basename(file) !== 'package.json') return

    fixPackageJSON(modules, file, true)
  })

  finder.once('end', done)
}

function fixPackageJSON (modules, file, overwrite) {
  if (file.split(path.sep).indexOf('react-native') >= 0) return

  const contents = fs.readFileSync(path.resolve(file), { encoding: 'utf8' })

  // var browser = pick(baseBrowser, modules)
  let pkgJson
  try {
    pkgJson = JSON.parse(contents)
  } catch (err) {
    console.warn('failed to parse', file)
    return
  }

  // if (shims[pkgJson.name]) {
  //   log('skipping', pkgJson.name)
  //   return
  // }

  // if (pkgJson.name === 'readable-stream') debugger

  let orgBrowser = pkgJson['react-native'] || pkgJson.browser || pkgJson.browserify || {}
  if (typeof orgBrowser === 'string') {
    orgBrowser = {}
    orgBrowser[pkgJson.main || 'index.js'] = pkgJson['react-native'] || pkgJson.browser || pkgJson.browserify
  }

  const depBrowser = extend({}, orgBrowser)
  for (const p in browser) {
    if (modules.indexOf(p) === -1) continue

    if (!(p in orgBrowser)) {
      depBrowser[p] = browser[p]
    } else if (!overwrite && orgBrowser[p] !== browser[p]) {
        log('not overwriting mapping', p, orgBrowser[p])
      } else {
        depBrowser[p] = browser[p]
      }
  }

  modules.forEach(function (p) {
    if (depBrowser[p] === false && browser[p] !== false) {
      log('removing browser exclude', file, p)
      delete depBrowser[p]
    }
  })


  const { main } = pkgJson
  if (typeof main === 'string') {
    const alt = main.startsWith('./') ? main.slice(2) : './' + main
    if (depBrowser[alt]) {
      depBrowser[main] = depBrowser[alt]
      log(`normalized "main" browser mapping in ${pkgJson.name}, fixed here: https://github.com/facebook/metro-bundler/pull/3`)
      delete depBrowser[alt]
    }
  }

  if (pkgJson.name === 'constants-browserify') {
    // otherwise react-native packager chokes for some reason
    delete depBrowser.constants
  }

  if (!deepEqual(orgBrowser, depBrowser)) {
    pkgJson['react-native'] = depBrowser
    if (pkgJson.browser || pkgJson.browserify) {
      pkgJson.browser = depBrowser
    }
    delete pkgJson.browserify
    fs.writeFileSync(file, prettify(pkgJson))
  }
}

function runHelp () {
  log(function () {

    /*
    Usage:
        rn-nodeify --install dns,stream,http,https
        rn-nodeify --install # installs all core shims
        rn-nodeify --hack    # run all package-specific hacks
        rn-nodeify --hack rusha,fssync   # run some package-specific hacks
    Options:
        -h  --help                  show usage
        -e, --hack                  run package-specific hacks (list or leave blank to run all)
        -i, --install               install shims (list or leave blank to install all)
        -o, --overwrite             updates installed packages if a newer version is available
        -y, --yarn                  use yarn to install packages instead of npm (experimental)

    Please report bugs!  https://github.com/mvayngrib/rn-nodeify/issues
    */
  }.toString().split(/\n/)
.slice(2, -2)
.join('\n'))
  process.exit(0)
}

function log () {
  console.log.apply(console, arguments)
}

function prettify (json) {
  return JSON.stringify(json, null, 2) + '\n'
}
