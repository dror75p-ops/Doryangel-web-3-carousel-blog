# n8n on Railway — pinned image

The Railway service `n8n` used to build from a third-party template whose
Dockerfile was `FROM n8nio/n8n:latest`, so every manual redeploy silently
upgraded n8n. This folder pins the exact image digest that was running when the
pin was made (build of 2026-10-05).

- `USER root` is kept on purpose: the existing volume at `/home/node/.n8n`
  (encryption key, settings) was written by the root user.
- Railway points at this folder (root directory `infra/n8n-railway`) and at a
  fixed commit, so pushes to this repository never redeploy n8n.
- To upgrade: back up first, pick a tested digest, change it here, then
  redeploy on purpose.
