variable "VERSION" {
  default = "latest"
}

variable "IMAGE_PREFIX" {
  default = "docmost"
}

variable "DOCKER_CACHE_DIR" {
  default = ".buildx-cache"
}

group "default" {
  targets = ["docmost"]
}

target "docmost" {
  context    = "."
  dockerfile = "Dockerfile"
  tags       = ["${IMAGE_PREFIX}/docmost:${VERSION}"]
  platforms  = ["linux/amd64", "linux/arm64"]
  cache-to   = ["type=local,dest=${DOCKER_CACHE_DIR},mode=max"]
  # Alibaba ACR rejects the OCI artifacts used for build attestations.
  attest = [
    "type=provenance,disabled=true",
    "type=sbom,disabled=true",
  ]
}
