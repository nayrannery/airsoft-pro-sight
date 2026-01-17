FROM node:20-bullseye

# ---------------------------
# 1. Variáveis e deps básicas
# ---------------------------
ENV DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y \
    git \
    curl \
    unzip \
    openjdk-17-jdk \
    && rm -rf /var/lib/apt/lists/*

# ---------------------------
# 2. Android SDK
# ---------------------------
ENV ANDROID_SDK_ROOT=/opt/android-sdk
RUN mkdir -p $ANDROID_SDK_ROOT

RUN curl -o sdk.zip https://dl.google.com/android/repository/commandlinetools-linux-11076708_latest.zip \
    && unzip sdk.zip -d /opt/android-sdk \
    && rm sdk.zip

RUN yes | $ANDROID_SDK_ROOT/cmdline-tools/bin/sdkmanager --sdk_root=$ANDROID_SDK_ROOT "platform-tools" \
    "platforms;android-34" \
    "build-tools;34.0.0" \
    "cmdline-tools;latest"

# ---------------------------
# 3. Yarn 1 (compat RN 0.81)
# ---------------------------
RUN corepack enable && corepack prepare yarn@1.22.22 --activate

# ---------------------------
# 4. Instala EAS CLI
# ---------------------------
RUN npm install -g eas-cli

# ---------------------------
# Workspace da aplicação
# ---------------------------
WORKDIR /project
