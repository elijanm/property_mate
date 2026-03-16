# # ── Build stage ────────────────────────────────────────────────────────────────
# FROM node:20-alpine AS builder
# WORKDIR /app
# COPY package.json ./
# RUN npm install
# COPY . .
# RUN npm run build

# # ── Serve stage ────────────────────────────────────────────────────────────────
# FROM nginx:1.27-alpine

# # Generate a self-signed TLS cert so getUserMedia works on mobile (requires HTTPS)
# RUN apk add --no-cache openssl && \
#     mkdir -p /etc/nginx/ssl && \
#     openssl req -x509 -nodes -days 3650 -newkey rsa:2048 \
#       -keyout /etc/nginx/ssl/self.key \
#       -out    /etc/nginx/ssl/self.crt \
#       -subj   "/CN=mldock-local/O=MLDock/C=KE"

# COPY --from=builder /app/dist /usr/share/nginx/html
# COPY nginx.conf /etc/nginx/conf.d/default.conf
# EXPOSE 80 443
# CMD ["nginx", "-g", "daemon off;"]

FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


FROM nginx:alpine AS final

COPY --from=builder /app/dist /usr/share/nginx/html
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
