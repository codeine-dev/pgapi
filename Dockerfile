FROM debian:bookworm-slim

ARG VERSION=latest

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl ca-certificates && \
    rm -rf /var/lib/apt/lists/*

SHELL ["/bin/bash", "-o", "pipefail", "-c"]

RUN INSTALL_SCRIPT="https://raw.githubusercontent.com/codeine-dev/pgapi/main/install.sh" && \
    if [ "$VERSION" = "latest" ]; then \
      curl -fsSL "$INSTALL_SCRIPT" | bash; \
    else \
      curl -fsSL "$INSTALL_SCRIPT" | bash -s -- --version "$VERSION"; \
    fi && \
    test -x "$(command -v pgapi)"

EXPOSE 3000
ENTRYPOINT ["pgapi"]
