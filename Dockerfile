FROM mcr.microsoft.com/playwright:v1.22.0-focal

WORKDIR /app

# Cài đặt dependencies
RUN apt-get update && apt-get install -y \
  wget \
  ca-certificates \
  fonts-liberation \
  libappindicator3-1 \
  libasound2 \
  libx11-xcb1 \
  libxtst6 \
  xdg-utils \
  --no-install-recommends \
  && rm -rf /var/lib/apt/lists/*

# Cài đặt node và Puppeteer
RUN wget -qO- https://deb.nodesource.com/setup_16.x | bash -
RUN apt-get install -y nodejs
RUN npm install puppeteer --save

# Sao chép mã nguồn của bạn vào container
COPY . /app

CMD ["node", "server-artlist.js"]
