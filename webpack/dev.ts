import { merge } from 'webpack-merge';
import base from './base';
import path from 'node:path';

export default merge(base, {
    mode: 'development',
    target: 'web',
    cache: {
        type: 'filesystem',
        name: 'dev',
    },
    output: {
        path: "C:\\Users\\sweet\\Source\\Repos\\tamperdav\\dav\\Tampermonkey\\sync\\",
        filename: "89ac3cdf-4d8e-4688-93d9-fee1ee13133a.user.js",
    },
    devtool: 'eval-source-map',
    watch: true,
    watchOptions: {
        ignored: /node_modules/,
    },
});