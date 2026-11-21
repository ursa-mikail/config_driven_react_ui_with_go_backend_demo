FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json* ./
# With a package-lock.json (run ./lock once) installs are exact; without one they fall back to npm install.
RUN if [ -f package-lock.json ]; then npm ci --no-audit --no-fund; else npm install --no-audit --no-fund; fi
COPY . .
RUN npm run build

FROM nginx:alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
