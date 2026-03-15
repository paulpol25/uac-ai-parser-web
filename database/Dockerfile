FROM postgres:16-alpine

# Copy initialization scripts (run in alphabetical order on first start)
COPY init/ /docker-entrypoint-initdb.d/

# Set permissions
RUN chmod -R 755 /docker-entrypoint-initdb.d/

EXPOSE 5432
