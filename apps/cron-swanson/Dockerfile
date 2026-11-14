# Cron Swanson on Railway (or any box): the Bun server, the page and the ticker in one process.
# Build from the repo root: docker build -f apps/cron-swanson/Dockerfile .
# Mount a volume at /data so jobs and runs outlive a redeploy. One replica only: two would fire every job twice.
FROM oven/bun:1
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile
WORKDIR /repo/apps/cron-swanson
ENV PORT=8080 NODE_ENV=production CRON_SWANSON_DB=/data/cron-swanson.sqlite
EXPOSE 8080
HEALTHCHECK CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "src/main.ts"]
