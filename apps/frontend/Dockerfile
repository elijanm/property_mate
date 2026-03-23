FROM node:20-alpine AS builder

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci
RUN npm install
COPY . .
RUN npm run build

FROM nginx:alpine AS final

COPY --from=builder /app/dist /usr/share/nginx/html

# SPA fallback + reverse-proxy /api/* → backend
ARG PMS_API_URL=http://backend:8000
RUN printf 'server {\n  listen 80;\n  root /usr/share/nginx/html;\n\n  location /api/ {\n    proxy_pass %s;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n  }\n\n  location / {\n    try_files $uri $uri/ /index.html;\n  }\n}\n' "$PMS_API_URL" \
  > /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]
