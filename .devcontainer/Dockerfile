# .devcontainer/Dockerfile
FROM mcr.microsoft.com/vscode/devcontainers/base:ubuntu

# Avoid prompts during apt installs
ENV DEBIAN_FRONTEND=noninteractive

# Update and install Chromium + Xvfb (for non-headless usage) and a few essentials
RUN apt-get update && apt-get install -y \
    chromium-browser \
    xvfb \
    ca-certificates \
    curl \
    git \
    --no-install-recommends && \
    rm -rf /var/lib/apt/lists/*

# Optional: create a non-root Chrome user data dir (used by run scripts)
RUN mkdir -p /workspace/.chrome-user-data && \
    chown -R vscode:vscode /workspace/.chrome-user-data

# Default workdir inside Codespaces
WORKDIR /workspaces