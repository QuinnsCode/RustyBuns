# Railway and the AWS fallback (App Runner, Lightsail, ECS) run the same image: the built page plus
# `bun src/serve.ts`. Build from the repo root: docker build -f apps/geoboxq/Dockerfile .
FROM oven/bun:1
WORKDIR /repo
COPY . .
RUN bun install --frozen-lockfile && cd apps/geoboxq && bun run build
WORKDIR /repo/apps/geoboxq
ENV PORT=8080
EXPOSE 8080
HEALTHCHECK CMD bun -e "fetch('http://localhost:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1),()=>process.exit(1))"
CMD ["bun", "src/serve.ts"]
