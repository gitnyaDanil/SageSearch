FROM node:22-alpine
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --ignore-scripts
COPY . ./
ENV NODE_ENV=production
CMD ["npm", "start"]
