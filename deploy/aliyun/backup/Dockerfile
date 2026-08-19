FROM mysql:8.4

RUN microdnf install -y python3 python3-pip openssl gzip ca-certificates \
    && pip3 install --no-cache-dir awscli \
    && microdnf clean all

WORKDIR /work
