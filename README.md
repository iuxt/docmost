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
npm run docker-push # Automatically increment the patch version, build, and push
npm run deploy
```

`docker-push` automatically increments the patch version (for example,
`0.97.0` → `0.97.1`) in the root, client, and server `package.json` files before
building, and uses the new version as the image tag. Failed builds or pushes
restore the original package files. Successful pushes keep the new version for
the next release and for `npm run deploy`. No Git commit or tag is created;
commit the updated package files to preserve the version across checkouts.

Versions follow `x.y.z` (major, minor, patch). Choose which part to increment,
or specify the complete release version:

```sh
npm run docker-push -- --bump patch # 1.2.3 -> 1.2.4 (default)
npm run docker-push -- --bump minor # 1.2.3 -> 1.3.0
npm run docker-push -- --bump major # 1.2.3 -> 2.0.0
npm run docker-push -- --version 1.2.3 # Set all three package versions and publish 1.2.3
```

`--bump` and `--version` cannot be combined with each other or `ITIER_VERSION`.
Version components must be nonnegative integers without leading zeros.

`npm run docker-build` builds the current version without incrementing it.
The manual `bump-version`, `bump-minor`, and `bump-major` commands remain available.
Set `ITIER_VERSION` to override the image tag and skip the automatic increment
(for example, when republishing an existing version). `config.image_prefix` is
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

Both Dockerfiles compile the JavaScript and frontend assets once on the builder's
native architecture, while installing native runtime dependencies separately for
each target architecture. Dependency layers ignore release version changes;
the original package versions are restored before compilation and in the final
image. BuildKit caches the pnpm store between builds, and the runtime image keeps
dependencies in a separate layer from the compiled app. Keep the same builder and
its cache for faster subsequent releases; the first build still downloads dependencies.

If all deployment servers use one architecture, build and push only that platform:

```sh
npm run docker-push -- --set docmost.platform=linux/amd64
# For ARM servers, use docmost.platform=linux/arm64 instead.
```

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
text. Configure `TYPESENSE_URL`, `TYPESENSE_API_KEY`, and optionally
`TYPESENSE_LOCALE` (`en` by default, `zh` for Chinese) on the server. Workspace
administrators can then enable **Use Typesense search** under **Settings →
Workspace → General** without restarting the server. The control is disabled
until the server has Typesense configured. The API key stays on the server.
Typesense's [collection documentation](https://typesense.org/docs/30.1/api/collections.html)
describes language-specific tokenization.

`SEARCH_DRIVER` sets the default for workspaces that have not saved a search
preference (`database` by default). A saved workspace preference overrides it,
including when Typesense is the server default.

For Docker Compose, put a strong `TYPESENSE_API_KEY` in `.env` and run:

```sh
docker compose -f docker-compose.yml -f docker-compose.search.yml up -d
```

The override uses Chinese tokenization by default, persists the index, and keeps
Typesense off the host's public ports. Build the updated Docmost image before
starting it; the upstream image does not include this integration.

While Typesense is configured, pages are indexed in background batches on startup
and reconciled hourly, even when the server's default search driver is database.
Creates, edits, restores, and deletes are synchronized through the search queue.
Enabling Typesense for a workspace also queues a backfill of that workspace's
existing pages. Initial indexing is asynchronous, so results can be incomplete
until it finishes. Changing the locale builds a new collection; old locale
collections remain available for manual cleanup.

Search results are checked against live workspace, space, page, public-space,
and share permissions in PostgreSQL. Creator, label, and archived-space filters
also use live database state. Typesense failures fall back to database search.
Turn off the workspace setting to use database search for that workspace; remove
the server's Typesense API key (and use `SEARCH_DRIVER=database`) to stop indexing.
This implementation covers pages; attachment text and AI search are separate
features.

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

