#!/bin/sh

set -e

dpm_checksum() (
  case $1 in
  3.4.11)
    case $2 in
    linux-amd64)
      echo 177328b8d8b5781a6eee37fbd172a8445f18e07b46292c40fe32207d4cd72ccd
      ;;
    linux-arm64)
      echo fcd1845fe808ab34dd6c1f33698fb53de0c351e41ac32185851bc10ca5565698
      ;;
    esac
    ;;
  esac
)

[ -n "$DPM_HOME" -a $# -eq 2 ]

sdk_version=$1
dpm_version=$2

platform=$(uname | tr [:upper:] [:lower:])-$(uname -m | sed 's/x86_64/amd64/;s/aarch64/arm64/')

mkdir -p $DPM_HOME
tarball=$DPM_HOME/dpm.tar.gz

curl -fsSL https://get.digitalasset.com/install/dpm-sdk/dpm-$sdk_version-$platform.tar.gz >$tarball
echo $(dpm_checksum $sdk_version $platform) $tarball | sha256sum -c -

tar xf $tarball -C $DPM_HOME --strip-components 1

$DPM_HOME/bin/dpm bootstrap $DPM_HOME
rm $tarball

# dpm uses the latest installed SDK by default with no way to select a version.
# Remove the bootstrap SDK so only the target version remains active.
if [ $dpm_version != $sdk_version ]; then
  $DPM_HOME/bin/dpm uninstall $sdk_version
fi

rm -r $DPM_HOME/cache/components/codegen-java $DPM_HOME/cache/oci-layout $DPM_HOME/oci-registry

$DPM_HOME/bin/dpm install $dpm_version
$DPM_HOME/bin/dpm version | grep -q $dpm_version
