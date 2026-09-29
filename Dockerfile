# Production Dockerfile for Apex Elite Contractor AI Platform
# Requires Node.js 22+ for native node:sqlite DatabaseSync support
FROM node:22-alpine

# Set working directory
WORKDIR /app

# Install dependencies (production only)
COPY package*.json ./
RUN npm ci --omit=dev

# Copy application files
COPY . .

# Ensure data directory exists for SQLite storage
RUN mkdir -p /app/data

# Expose standard web port
EXPOSE 3000

# Set environment defaults
ENV NODE_ENV=production
ENV PORT=3000

# Start server
CMD ["node", "src/server.js"]
