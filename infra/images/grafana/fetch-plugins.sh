#!/bin/sh
set -eu
arch="$1"
case "$arch" in amd64|arm64) ;; *) echo "Unsupported platform: $arch" >&2; exit 1 ;; esac
mkdir /plugins
jq -r --arg arch "$arch" '.[] | [.id, .version, .sha256[$arch]] | @tsv' /build/plugins.json |
while read -r id version checksum; do
  curl --fail --silent --show-error --location \
    "https://grafana.com/api/plugins/$id/versions/$version/download?os=linux&arch=$arch" \
    --output /tmp/plugin.zip
  echo "$checksum  /tmp/plugin.zip" | sha256sum -c -
  unzip -q /tmp/plugin.zip -d /plugins
done
find /plugins -type f -name 'gpx_*' -exec chmod 755 '{}' ';'
# Loki is rebuilt from the matching source and shipped as an image-owned core
# component, not as an upstream-signed external artifact.
rm /plugins/loki/MANIFEST.txt
