const ProvidePlugin = require("webpack").ProvidePlugin
const DefinePlugin = require("webpack").DefinePlugin
const Compilation = require("webpack").Compilation
const RawSource = require("webpack-sources").RawSource

// A simple plugin to to modify the contents of manifest.json based on the environment
const pluginName = "WebExtManifestPlugin";
class WebExtManifestPlugin {
  constructor(options) {
    this.options = options
  }

  apply(compiler) {
    compiler.hooks.thisCompilation.tap(pluginName, (compilation) => {

      compilation.hooks.processAssets.tap(
        {
          name: pluginName,

          // Using one of the later asset processing stages to ensure
          // that all assets were already added to the compilation by other plugins.
          stage: Compilation.PROCESS_ASSETS_STAGE_SUMMARIZE,
        },
        (assets) => {

          const manifestPath = this.options.manifestPath || "manifest.json"
          const manifest = JSON.parse(assets[manifestPath].source())

          if (this.options.vendor === "chrome") {
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
          // Write the modified manifest back
          assets[manifestPath] = {
            source: () => JSON.stringify(manifest, null, 2),
            size: () => JSON.stringify(manifest, null, 2).length
          }
          console.log(assets[manifestPath])
        }
      );
    });

    // })
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