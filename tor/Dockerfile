FROM alpine:3.23
RUN apk add --no-cache tor curl python3 ca-certificates \
    && mkdir -p /var/lib/tor \
    && chown tor:tor /var/lib/tor
COPY torrc /etc/tor/torrc
COPY service.py reader.py fetcher.py /opt/veil-tor/
USER tor
RUN tor --verify-config -f /etc/tor/torrc
CMD ["python3", "/opt/veil-tor/service.py"]
