#!/bin/sh

set -e

generator_path=/opt/openapi/openapi-generator.jar
spec_path=/opt/openapi/canton-openapi.yaml

generator_sha() (
  case $1 in
  7.21.0)
    echo 124727eacdb64fd6c9c1c3a78e353207ec1378d071bbdc15de79b0a30ed2ad6d
    ;;
  7.26.0)
    echo 1760050094997b9cc790cc1350be095f15da8c08a996b184d3eadc4ccda5e35e
    ;;
  esac
)

spec_sha() (
  case $1 in
  3.4.8)
    echo 1655fc73e60f77521248e667b497724a635c4d4611608ff7a2e5d6b8d19de78f
    ;;
  3.6.1)
    echo a5d32ba0f106aedb96cf57cb89a90bfac67fcc3236a56814954396c9cbb89353
    ;;
  esac
)

# SDK releases after 3.4 are tagged in digital-asset/canton instead of digital-asset/daml.
spec_url() (
  file=community/ledger/ledger-json-api/src/test/resources/json-api-docs/openapi.yaml

  case $1 in
  3.4.*)
    echo https://raw.githubusercontent.com/digital-asset/daml/refs/tags/v$1/sdk/canton/$file
    ;;
  *)
    echo https://raw.githubusercontent.com/digital-asset/canton/refs/tags/v$1/$file
    ;;
  esac
)

alias curl='curl -fsSL'

[ $# -eq 2 ]

generator_version=$1
sdk_version=$2

generator_url=https://repo1.maven.org/maven2/org/openapitools/openapi-generator-cli/$generator_version/openapi-generator-cli-$generator_version.jar

mkdir -p $(dirname $generator_path)
curl $generator_url >$generator_path
echo $(generator_sha $generator_version) $generator_path | sha256sum -c -

curl $(spec_url $sdk_version) >$spec_path
echo $(spec_sha $sdk_version) $spec_path | sha256sum -c -

cat >/usr/local/bin/canton-openapi-generator <<EOF
#!/bin/sh

command=\$1
shift

if [ \$command = generate ]; then
  options='-i $spec_path'
fi

exec java -jar $generator_path \$command \$options "\$@"
EOF
chmod +x /usr/local/bin/canton-openapi-generator

echo "OpenAPI generator $generator_version + Canton spec (SDK $sdk_version) installed"
