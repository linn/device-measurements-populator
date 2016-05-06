FROM node:4-slim

EXPOSE 3000

WORKDIR /usr/src/app

COPY . /usr/src/app

RUN npm install --production --quiet

CMD [ "npm", "start" ]
