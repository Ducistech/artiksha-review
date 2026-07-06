FROM node:20-alpine
RUN apk add --no-cache openssl

WORKDIR /app

# Install ALL deps (the build needs vite/remix devDependencies). Keep NODE_ENV unset
# during install so devDependencies are included; switch to production for runtime below.
COPY package.json package-lock.json* ./
RUN npm ci && npm cache clean --force

COPY . .
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000
# docker-start = prisma generate + prisma migrate deploy + remix-serve (binds to $PORT)
CMD ["npm", "run", "docker-start"]
