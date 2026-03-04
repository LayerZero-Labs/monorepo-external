ARG NODE_VERSION=22.14.0

FROM node:${NODE_VERSION}-bookworm-slim

ARG FORGE_VERSION=1.3.6
ARG HARDHAT_VERSION=2.26.3

# TODO Use the builder pattern instead.
ENV BUILD_PACKAGES='ca-certificates curl git'

RUN <<-EOF
  set -e
  apt-get update --fix-missing
  apt-get install -y --no-install-recommends $BUILD_PACKAGES
  apt-get clean
  rm -rf /var/lib/apt/lists/*
EOF

# TODO Stay away from global installation which Hardhat v3 doesn't support.
# Note that this global installation and `NODE_PATH` works only with Hardhat v2 with CommonJS.
RUN npm install --global \
  @layerzerolabs/hardhat-tron@3.0.134 \
  @matterlabs/hardhat-zksync-deploy@1.2.0 \
  @matterlabs/hardhat-zksync-solc@1.3.2 \
  ethers@6.7.1 \
  hardhat@${HARDHAT_VERSION} \
  hardhat-deploy@0.12.4 \
  ts-node@10.9.2 \
  typescript@5.3.3 \
  zksync-ethers@6.7.1 \
  sol-merger@4.4.2

COPY ./hardhat.config.cjs ./tasks.cjs ./compiler-versions.json /hardhat/
RUN ln -s /hardhat/hardhat.config.cjs /hardhat/hardhat.default.config.js

COPY ./flatten.sh ./flatten_dir.sh ./sol_merger.sh /usr/local/bin/
RUN chmod +x /usr/local/bin/flatten.sh /usr/local/bin/flatten_dir.sh /usr/local/bin/sol_merger.sh

ENV HARDHAT_DISABLE_TELEMETRY_PROMPT=true
ENV HARDHAT_EXPERIMENTAL_ALLOW_NON_LOCAL_INSTALLATION=true
ENV NODE_PATH=/usr/local/lib/node_modules
ENV ZKSYNC_DISABLE_TELEMETRY=1

RUN <<-EOF
  set -e
  unset HARDHAT_VERSION
  cd /hardhat
  hardhat download:all
  hardhat download:all --network tron-mainnet
EOF

ENV PATH=/root/.foundry/bin:$PATH

RUN curl -fsSL https://foundry.paradigm.xyz | bash
RUN foundryup --install $FORGE_VERSION

RUN apt-get -y remove $BUILD_PACKAGES
