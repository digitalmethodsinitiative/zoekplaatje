#!/bin/zsh
VERSION=$(grep '"version"' manifest.json | cut -d'"' -f 4);
zip -r zoekplaatje-v$VERSION.zip . -x "*.DS_Store" "__MACOSX" js/mitm.js js/ponyfill-2.0.2.js js/streamsaver-2.0.3.js js/webtorrent.min.js -x "*.git*" -x "*.idea*" -x "create-zip.sh" -x "*.zip" -x "*.xpi"
