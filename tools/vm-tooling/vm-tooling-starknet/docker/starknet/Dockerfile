FROM debian:bookworm-slim

ARG SCARB_VERSION=2.14.0
ARG STARKNET_FOUNDRY_VERSION=0.49.0
ARG ASDF_VERSION=0.14.0

RUN <<-EOF
  set -e
  apt-get -y update --fix-missing
  apt-get -y install curl git
  apt-get -y clean
  rm -rf /var/lib/apt
EOF

# Install asdf
RUN git clone https://github.com/asdf-vm/asdf.git ~/.asdf --branch v$ASDF_VERSION

# Ensure tools are available in PATH for all users, including universal-sierra-compiler
ENV PATH=/root/.local/bin:/root/.asdf/bin:/root/.asdf/shims:$PATH

RUN <<-EOF bash -e
  . /root/.asdf/asdf.sh
  . /root/.asdf/completions/asdf.bash

  install() (
    asdf plugin add \$1
    asdf install \$1 \$2
    asdf global \$1 \$2
  )

  install scarb $SCARB_VERSION
  install starknet-foundry $STARKNET_FOUNDRY_VERSION

  # Install universal-sierra-compiler using the function from starknet-foundry plugin
  . /root/.asdf/plugins/starknet-foundry/lib/utils.bash
  download_universal_sierra_compiler
EOF
