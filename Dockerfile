FROM node:24-slim

EXPOSE 3000

WORKDIR /usr/src/app

COPY . /usr/src/app

ARG VCS_REF
ARG VERSION
ARG BUILD_DATE

LABEL org.label-schema.vendor="Linn Products Ltd." \
      org.label-schema.build-date=$BUILD_DATE \
      org.label-schema.docker.dockerfile="/Dockerfile" \
      org.label-schema.version=$VERSION \
      org.label-schema.vcs-ref=$VCS_REF \
      org.label-schema.vcs-type="Git" \
      org.label-schema.vcs-url="https://github.com/linn/device-measurements-populator"

RUN npm ci --omit=dev --quiet

# node directly, never `npm start`: npm runs the script under `sh -c`, which leaves node a grandchild
# of PID 1. The signal npm forwards on shutdown stops at that shell, so the drain never runs and every
# in-flight request is severed.
ENTRYPOINT [ "node", "./bin/www" ]