#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
rm -rf -- dist
mkdir dist
cp -R index.html assets tools dist/
