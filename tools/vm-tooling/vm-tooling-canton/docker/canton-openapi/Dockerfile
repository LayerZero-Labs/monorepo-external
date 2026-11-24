FROM public.ecr.aws/docker/library/debian:bookworm-slim@sha256:7ff6ba31527b9e336162fa061746c366c4b2032f4d2cff2078bea43f78efe3f8

ARG DEBIAN_SNAPSHOT=20261021T023223Z
ARG CA_CERTIFICATES_VERSION=20250419~deb12u2
ARG CURL_VERSION=7.88.1-10+deb12u15
ARG GOSU_VERSION=1.14-1+b10
ARG OPENJDK_17_JRE_HEADLESS_VERSION=17.0.20.1+1-1~deb12u1

RUN cat > /etc/apt/sources.list.d/debian.sources <<EOF
Types: deb
URIs: http://snapshot.debian.org/archive/debian/${DEBIAN_SNAPSHOT}
Suites: bookworm bookworm-updates
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
Check-Valid-Until: no

Types: deb
URIs: http://snapshot.debian.org/archive/debian-security/${DEBIAN_SNAPSHOT}
Suites: bookworm-security
Components: main
Signed-By: /usr/share/keyrings/debian-archive-keyring.gpg
Check-Valid-Until: no
EOF

RUN <<-EOF
  set -e
  apt-get update
  apt-get install -y --no-install-recommends \
    ca-certificates=${CA_CERTIFICATES_VERSION} \
    curl=${CURL_VERSION} \
    gosu=${GOSU_VERSION} \
    openjdk-17-jre-headless=${OPENJDK_17_JRE_HEADLESS_VERSION}
  # ca-certificates 20250419~deb12u2 drops emSign ECC Root CA - G3 and the Comodo AAA Services root.
  # An empty Java store would pass the grep, so check it first
  test -s /etc/ssl/certs/java/cacerts
  java_roots=$(keytool -list -cacerts -storepass changeit)
  # `! cmd` is exempt from `set -e`, so fail explicitly
  if ls /etc/ssl/certs | grep -qiE 'emsign_ecc_root_ca_-_g3|comodo_aaa' \
    || echo "$java_roots" | grep -qiE 'emsign_ecc_root_ca_-_g3|comodo_aaa'; then
    echo "emSign ECC Root CA - G3 or Comodo AAA still present in the system or Java trust store" >&2
    exit 1
  fi
  apt-get clean
  rm -rf /var/lib/apt/lists/* /var/log/apt /var/log/dpkg.log /var/log/alternatives.log /var/cache/ldconfig/aux-cache
EOF

ARG TARGETARCH
ARG APT_HASH_AMD64=d58a0f853aab1dd2eb10eed99ffaf9ba9fb210315381e39402b2dd7d223ff99f
ARG APT_HASH_ARM64=ed0aedb6678c8153b4b73dc1dab72692f49f9bc02e2379bfc414da91fb5de1a4

# Hash existing regular package files. Slim images omit some files listed by dpkg;
# symlinks and removed logs are excluded.
SHELL ["/bin/bash", "-o", "pipefail", "-c"]
RUN set -eu; \
    case "${TARGETARCH}" in \
      amd64) expected_hash="${APT_HASH_AMD64}" ;; \
      arm64) expected_hash="${APT_HASH_ARM64}" ;; \
      *) echo "ERROR: unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac; \
    actual_hash="$(dpkg-query --showformat='${Package}\n' --show | xargs -r dpkg -L | \
      LC_ALL=C sort -u | while IFS= read -r file; do \
        if [ -f "$file" ] && [ ! -L "$file" ]; then printf '%s\0' "$file"; fi; \
      done | LC_ALL=C sort -z | xargs -0 -r sha256sum | sha256sum | cut -d ' ' -f 1)"; \
    printf 'APT_HASH_%s=%s\n' "${TARGETARCH^^}" "${actual_hash}"; \
    [ "${actual_hash}" = "${expected_hash}" ] || \
      { echo "ERROR: apt package binary hash mismatch" >&2; exit 1; }
SHELL ["/bin/sh", "-c"]

ARG OPENAPI_GENERATOR_VERSION=7.26.0
ARG SDK_VERSION=3.6.1

COPY ./install_openapi.sh /tmp/install_openapi.sh
RUN /tmp/install_openapi.sh $OPENAPI_GENERATOR_VERSION $SDK_VERSION
RUN rm /tmp/install_openapi.sh

COPY entrypoint.sh /usr/local/bin/entrypoint.sh
ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
