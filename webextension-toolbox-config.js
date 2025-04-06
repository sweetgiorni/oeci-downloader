const { resolve } = require('path')
const GlobEntriesPlugin = require('webpack-watched-glob-entries-plugin')

module.exports = {
  webpack: (config, { dev, vendor }) => {
    // Add typescript loader. supports .ts and .tsx files as entry points
    // config.resolve.extensions.push('.ts')
    // config.resolve.extensions.push('.tsx')
    // config.entry = GlobEntriesPlugin.getEntries(
    //   [
    //     resolve('app', '*.{js,mjs,jsx,ts,tsx}'),
    //     resolve('app', '?(scripts)/*.{js,mjs,jsx,ts,tsx}')
    //   ]
    // )
    /* // add tslint support
    config.module.rules.push({
      test: /\.tsx?$/,
      enforce: 'pre',
      use: [{
        loader: 'tslint-loader',
        options: {
          tsConfigFile: 'tsconfig.json',
          emitErrors: true
        }
      }]
    }) */

    // config.module.rules.push({
    //   test: /\.tsx?$/,
    //   loader: 'ts-loader'
    // })

    // console.log(config.plugins)
    // for (let i = 0; i < config.plugins.length; i++) {
    //   if (config.plugins[i].constructor.name === 'EnvironmentPlugin') {
    //     config.plugins[i].defaultValues['NODE_ENV'] = 'development'
    //   }
    // }
    // config.plugins[4].dhost.gf = '127.0.0.1'
    // Important: return the modified config
    return config
  },
  // copyIgnore: [ '**/*.js', '**/*.json', '**/*.ts', '**/*.tsx' ]
}