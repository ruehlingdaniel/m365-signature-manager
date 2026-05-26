FROM node:22-alpine AS base

# samba-client liefert das smbclient-Binary fuer SMB-Push auf Windows-TS
# tzdata wird gebraucht, damit der TZ-Env-Var (Europe/Berlin) wirkt
RUN apk add --no-cache samba-client tini tzdata

WORKDIR /app

# Backend deps
COPY backend/package.json backend/package-lock.json* ./backend/
RUN cd backend && npm install --omit=dev

# Source kopieren
COPY backend ./backend
COPY frontend ./frontend

# Datenverzeichnis fuer SQLite (per Volume gemountet)
RUN mkdir -p /app/backend/data && chown -R node:node /app

USER node

ENV NODE_ENV=production
ENV PORT=4000
ENV DB_PATH=/app/backend/data/signatures.db
EXPOSE 4000

WORKDIR /app/backend

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
