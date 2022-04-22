FROM node:17 as build
RUN echo "Running on node/npm verson:"
RUN node --version
RUN npm --version

ARG build_env=somevar
ENV BUILD_ENV=${build_env}
RUN echo "Building 141x-madax-gs docker image in $build_env mode."

RUN mkdir /app
WORKDIR /app

COPY . /app

RUN npm i

ENV NODE_ENV $build_env

RUN ls -lah
RUN chmod a+x exec.sh
ENTRYPOINT ["./exec.sh"]
