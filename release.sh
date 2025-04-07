#!/usr/bin/env zsh

set -Eeuo pipefail

rm -rf dist packages

webextension-toolbox build chrome
webextension-toolbox build firefox

cp -r packages /mnt/c/Users/sweet/Desktop/