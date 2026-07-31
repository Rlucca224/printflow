FROM node:20-slim

# Instalar qrencode para generar QRs
RUN apt-get update && apt-get install -y qrencode && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --production

COPY server/ .

# Crear directorio de datos persistentes
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

CMD ["node", "index.js"]
