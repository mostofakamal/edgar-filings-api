# Minimal single-stage image (core milestone). Multi-stage build, non-root user and a
# HEALTHCHECK are in the hardening milestone. No SEC_USER_AGENT here: pass it at run time.
FROM node:26.13.1-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build && npm prune --omit=dev
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "dist/main.js"]
