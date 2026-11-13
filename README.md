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

`--bump` and `--version` cannot be combined with each other or `VERSION`.
Version components must be nonnegative integers without leading zeros.

`npm run docker-build` builds the current version without incrementing it.
The manual `bump-patch`, `bump-minor`, and `bump-major` commands remain available.
Set `VERSION` to override the image tag and skip the automatic increment
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

Both Docker commands also import and export build layers in the host directory
`.buildx-cache/` using `mode=max`, including intermediate dependency and build
stages. This directory is excluded from Git and the Docker build context. Set
`DOCKER_CACHE_DIR` to an absolute path to store it elsewhere, for example:

```sh
DOCKER_CACHE_DIR="$HOME/.cache/docmost-buildx" npm run docker-push -- \
  --allow="fs=$HOME/.cache/docmost-buildx"
```

On the first build, the npm commands only export the cache. They enable cache
imports automatically once `index.json` exists in the cache directory.

The pnpm cache mounts remain in BuildKit's own persistent storage; local layer
exports do not include their contents. Keep the same builder to reuse downloaded
packages when dependencies change. Local layer exports retain older blobs and
can grow over time; remove the cache directory between builds to reclaim space.

If all deployment servers use one architecture, build and push only that platform:

```sh
npm run docker-push -- --set docmost.platform=linux/amd64
# For ARM servers, use docmost.platform=linux/arm64 instead.
```

For registry compatibility (including Alibaba ACR), build attestations
(provenance and SBOM) are disabled, and `docker-push` exports Docker media types
with OCI artifact output disabled. Both image architectures are still included.

Deploy requires SSH access, registry access, and an existing deployment directory
with configured environment/secrets. It detects the deployment method:

- **Docker Compose:** requires a standard Compose filename in `DEPLOY_DIR`, with
  the Docmost image using `${IMAGE_PREFIX}/docmost:${VERSION}`. It validates the
  configuration, pulls the selected image, and recreates only `docmost`.
- **Nebula:** requires `run.sh`, `.env`, and the sibling `public/app.sh` and
  `public/image_config.py` helpers. It pulls the selected image first, updates
  only `IMAGE_NAME` and `IMAGE_VERSION` in the service's `.env`, then runs
  `bash ./run.sh`, including that script's configured dependency hooks.

`VERSION` overrides the image tag for builds and deployment. Preview the remote
commands with `npm run deploy -- --dry-run`.

### Typesense search

This fork includes an independent Typesense integration for page titles and body
text. Configure the shared server connection in `.env`:

```dotenv
TYPESENSE_URL=http://typesense:8108
TYPESENSE_API_KEY=REPLACE_WITH_LONG_RANDOM_KEY
```

Use an address reachable from the Docmost server and a key with collection and
document management permissions. Generate a strong key with `openssl rand -hex 32`.
Both values are required; leave both empty to use database search only. Restart or
recreate Docmost after changing them. The supplied Compose file passes these
variables to the Docmost container.

Workspace administrators configure the language (`zh` for Chinese, `en` for English)
under **Settings → Workspace → General**. **Test connection** checks the server's
configured address and key without saving. **Save settings** validates the
connection, saves the workspace language, and queues a backfill. Enable **Use
Typesense search** to use it for that workspace. Language and enablement remain
isolated by workspace. The address and API key are never returned to the browser
or saved in the database.

When upgrading from workspace connection settings, put the address and key in
`.env` before restarting. The migration removes the stored addresses and encrypted
keys while preserving workspace language preferences.

Typesense is a separate service and must already be running. To start the bundled
service with the same API key from `.env`, use:

```sh
docker compose -f docker-compose.yml -f docker-compose.search.yml up -d
```

The override persists the index and keeps Typesense off the host's public ports.
Build the updated Docmost image before starting it; the upstream image does not
include this integration.

Configured workspaces are indexed in background batches on startup and reconciled
hourly, even when database search is selected. Creates, edits, restores, and
deletes are synchronized through the search queue. Saving workspace search
settings or enabling Typesense queues a backfill of existing pages. Initial indexing is asynchronous,
so results can be incomplete until it finishes. Changing the locale builds a new
collection; old locale collections remain available for manual cleanup.
Index version upgrades also rebuild existing pages in a new collection. Version 2
uses matching Han character boundaries when indexing and querying, so Chinese
terms and adjacent numbers (for example, `帅哥` and `123456` in `我的帅哥123456`)
are searchable in both Chinese and English workspaces. Queries require all tokens
and do not apply typo correction to numbers.
Typesense's [collection documentation](https://typesense.org/docs/30.1/api/collections.html)
describes language-specific tokenization.

Search results are checked against live workspace, space, page, public-space,
and share permissions in PostgreSQL. Creator, label, and archived-space filters
also use live database state. Typesense failures fall back to database search.
Turn off the workspace setting to use database search for that workspace.
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

