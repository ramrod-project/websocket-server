FROM mhart/alpine-node:10.5.0

WORKDIR /srv/node-app

COPY ./package.json .

RUN npm i

COPY . .

EXPOSE 3000

CMD ["npm", "start"]
