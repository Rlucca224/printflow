FROM node:20-alpine

# Instalar qrencode para generar QRs
RUN apk add --no-cache qrencode-tools

WORKDIR /app

COPY server/package.json server/package-lock.json* ./
RUN npm install --production

COPY server/ .

# Crear directorio de datos persistentes
RUN mkdir -p /app/data /app/uploads

EXPOSE 3000

CMD ["node", "index.js"]
