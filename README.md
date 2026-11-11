<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        Open-source collaborative wiki and documentation software.
        <br />
        <a href="https://docmost.com"><strong>Website</strong></a> | 
        <a href="https://docmost.com/docs"><strong>Documentation</strong></a> |
        <a href="https://twitter.com/DocmostHQ"><strong>Twitter / X</strong></a>
    </p>
</div>
<br />

## Getting started

To get started with Docmost, please refer to our [documentation](https://docmost.com/docs) or try our [cloud version](https://docmost.com/pricing) .

### Build and deploy your own image

Set the image registry/namespace and deployment destination in the root
`package.json` before building or deploying:

```json
"config": {
  "image_prefix": "ghcr.io/your-org",
  "deploy_host": "user@server",
  "deploy_dir": "/opt/docmost"
}
```

```sh
pnpm run bump-version # Increment patch; use bump-minor or bump-major for other releases
pnpm run docker-build
pnpm run docker-push
pnpm run deploy
```

Version bumps update the root, client, and server `package.json` files without
creating a Git commit or tag. Image commands use the root package version by
default; set `ITIER_VERSION` to override the image tag. `config.image_prefix` is
the registry/namespace before `/docmost` and defaults to `docmost`.
`IMAGE_PREFIX`, `DEPLOY_HOST`, and `DEPLOY_DIR` environment variables override
the corresponding `package.json` settings when provided. Set `config.deploy_host`
before deploying; it is empty by default.

Both Docker commands build `linux/amd64` and `linux/arm64` using Buildx Bake and
the standard `Dockerfile`. The builder must support both platforms (through
native workers or emulation). `docker-build` loads the images locally and requires
the containerd image store; the classic Docker image store cannot load a
multi-platform image. `docker-push` publishes the multi-platform image to the
registry after you have logged in with `docker login`.

For registry compatibility (including Alibaba ACR), build attestations
(provenance and SBOM) are disabled, and `docker-push` exports Docker media types
with OCI artifact output disabled. Both image architectures are still included.

Deploy requires SSH access to a server with Docker Compose and an existing
deployment directory containing this repository's updated `docker-compose.yml`
and the configured environment/secrets. The server must have registry access.
It pulls the selected image and recreates only the `docmost` service. Preview
the SSH command with `pnpm run deploy --dry-run`.

### Typesense search

This fork includes an independent Typesense integration for page titles and body
text. Set `SEARCH_DRIVER=typesense`, `TYPESENSE_URL`, `TYPESENSE_API_KEY`, and
optionally `TYPESENSE_LOCALE` (`en` by default, `zh` for Chinese). The API key
stays on the server. Typesense's [collection documentation](https://typesense.org/docs/30.1/api/collections.html)
describes language-specific tokenization.

For Docker Compose, put a strong `TYPESENSE_API_KEY` in `.env` and run:

```sh
docker compose -f docker-compose.yml -f docker-compose.search.yml up -d
```

The override uses Chinese tokenization by default, persists the index, and keeps
Typesense off the host's public ports. Build the updated Docmost image before
starting it; the upstream image does not include this integration.

Existing pages are indexed in background batches on startup, then reconciled
hourly. Creates, edits, restores, and deletes are synchronized through the search
queue. Initial indexing is asynchronous, so results can be incomplete until it
finishes. Changing the locale builds a new collection; old locale collections
remain available for manual cleanup.

Search results are checked against live workspace, space, page, public-space,
and share permissions in PostgreSQL. Creator, label, and archived-space filters
also use live database state. Typesense failures fall back to database search;
set `SEARCH_DRIVER=database` to disable the integration. This implementation
covers pages; attachment text and AI search are separate features.

## Features

- Real-time collaboration
- Diagrams (Draw.io, Excalidraw and Mermaid)
- Spaces
- Permissions management
- Groups
- Comments
- Page history
- Search
- File attachments
- Embeds (Airtable, Loom, Miro and more)
- Translations (10+ languages)

### Screenshots

<p align="center">
<img alt="home" src="https://docmost.com/screenshots/home.png" width="70%">
<img alt="editor" src="https://docmost.com/screenshots/editor.png" width="70%">
</p>

### License
Docmost core is licensed under the open-source AGPL 3.0 license.  
Enterprise features are available under an enterprise license (Enterprise Edition).  

All files in the following directories are licensed under the Docmost Enterprise license defined in `packages/ee/License`.
  - apps/server/src/ee
  - apps/client/src/ee
  - packages/ee

### Contributing

See the [development documentation](https://docmost.com/docs/self-hosting/development)

## Thanks
Special thanks to;

<img width="100" alt="Crowdin" src="https://github.com/user-attachments/assets/a6c3d352-e41b-448d-b6cd-3fbca3109f07" />

[Crowdin](https://crowdin.com/) for providing access to their localization platform.


<img width="48" alt="Algolia-mark-square-white" src="https://github.com/user-attachments/assets/6ccad04a-9589-4965-b6a1-d5cb1f4f9e94" />

[Algolia](https://www.algolia.com/) for providing full-text search to the docs.

