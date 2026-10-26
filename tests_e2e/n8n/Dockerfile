# n8n with this package installed where n8n keeps community nodes
# (~/.n8n/nodes/node_modules), as Settings → Community nodes would.
# Build context: a folder holding `package/`, the `npm pack` tarball extracted.
ARG N8N_IMAGE=docker.n8n.io/n8nio/n8n:2.44.7
FROM ${N8N_IMAGE}
COPY --chown=node:node package/ /home/node/.n8n/nodes/node_modules/n8n-nodes-opentodo/
