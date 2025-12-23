FROM docker.n8n.io/n8nio/n8n:latest
USER root
# copy the compiled node (dist) into a location we'll reference
COPY ./dist /opt/custom-nodes/my-node
USER node
ENV N8N_CUSTOM_EXTENSIONS=/opt/custom-nodes/my-node
