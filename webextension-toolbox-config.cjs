const ProvidePlugin = require("webpack").ProvidePlugin
const DefinePlugin = require("webpack").DefinePlugin

// A simple plugin to to modify the contents of manifest.json based on the environment
class WebExtManifestPlugin {
  constructor(options) {
    this.options = options
  }

  apply(compiler) {
    compiler.hooks.emit.tapAsync("WebExtManifestPlugin", (compilation, callback) => {
      const manifestPath = this.options.manifestPath || "manifest.json"
      const manifest = JSON.parse(compilation.assets[manifestPath].source())

      if (this.options.vendor == "chrome") {
        manifest.background.service_worker = "background.js"
        // Delete the old background script if it exists
        if (manifest.background.scripts) {
          delete manifest.background.scripts
        }
      } else if (this.options.vendor == "firefox") {
        manifest.background.scripts = ["background.js"]
        // Delete the old service worker if it exists
        if (manifest.background.service_worker) {
          delete manifest.background.service_worker
        }
      }
      // Write the modified manifest back to the file system
      compilation.assets[manifestPath] = {
        source: () => JSON.stringify(manifest, null, 2),
        size: () => JSON.stringify(manifest, null, 2).length
      }

      callback()
    })
  }
}

module.exports = {
  webpack: (config, { dev, vendor }) => {
    config.plugins.push(
      new ProvidePlugin({
        browser: "webextension-polyfill"
      })
    )
    config.plugins.push(
      new WebExtManifestPlugin({
        vendor: vendor,
        manifestPath: "manifest.json"
      })
    )
    config.plugins.push(
      new DefinePlugin({
        VENDOR: JSON.stringify(vendor),
      }),
    )
    return config
  },
}