FROM node:20-alpine AS build
WORKDIR /app
COPY open-dashboard-frontend/package.json open-dashboard-frontend/package-lock.json* ./
RUN npm install
COPY open-dashboard-frontend/ .
# Source of truth: .teamai/docs/user-manual → public/help (also synced by vite plugin)
COPY .teamai/docs/user-manual/index.html ./public/help/index.html
COPY .teamai/docs/user-manual/screenshots ./public/help/screenshots
RUN npm run build

FROM nginx:alpine
COPY open-dashboard-frontend/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
