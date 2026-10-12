-- A hook that speaks GitHub (src/hooks.ts): GitHub's event names, headers and payload fields,
-- so receivers built for GitHub (Jenkins, Buildkite, Argo Events, Tekton) trigger on it.
ALTER TABLE webhooks ADD COLUMN github_compat INTEGER NOT NULL DEFAULT 0;
